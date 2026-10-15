import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { MAX_SETUP_BYTES } = require('./sfx-format.cjs');
const {
  MAX_COMPONENT_BYTES,
  MAX_NON_COMPONENT_BYTES,
  MAX_NSIS_BYTES,
  MAX_NSIS_NON_COMPONENT_BYTES,
  assertSetupBudget,
  assertNsisBudget,
  readComponentArchiveBytes,
  assertPayloadDeduplication,
  verifyFinalNsisBudget,
} = require('./distribution-budget.cjs');
const targets = require('../nsis-offline-components.json');
const MiB = 1024 * 1024;
const roots: string[] = [];
function root() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zhiyuan-budget-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('WebView2 has explicit independent limits without changing the component ceiling', () => {
  expect(MAX_SETUP_BYTES).toBe(500 * MiB);
  expect(MAX_COMPONENT_BYTES).toBe(300 * MiB);
  expect(MAX_NON_COMPONENT_BYTES).toBe(220 * MiB);
  expect(assertSetupBudget(500 * MiB, 280 * MiB)).toMatchObject({
    installerBytes: 500 * MiB,
    componentArchiveBytes: 280 * MiB,
    nonComponentBytes: 220 * MiB,
  });
  expect(() => assertSetupBudget(500 * MiB + 1, 300 * MiB)).toThrow(/500 MiB/);
  expect(() => assertSetupBudget(400 * MiB, 300 * MiB + 1)).toThrow(/300 MiB/);
  expect(() => assertSetupBudget(230 * MiB + 1, 10 * MiB)).toThrow(/220 MiB/);
});

test('the real Windows build fits and signature bytes consume the remaining budget', () => {
  expect(assertSetupBudget(491_244_872, 288_626_662).nonComponentBytes).toBe(202_618_210);
  const componentBytes = 280 * MiB;
  const preSignatureBytes = MAX_SETUP_BYTES - 8;
  expect(() => assertSetupBudget(preSignatureBytes, componentBytes)).not.toThrow();
  expect(() => assertSetupBudget(preSignatureBytes + 16, componentBytes)).toThrow(/500 MiB/);
  expect(() => assertSetupBudget(220 * MiB + 100 + 16, 100)).toThrow(/220 MiB/);
});

test('NSIS keeps its original 450/150 MiB limits independently of WebView2', () => {
  expect(MAX_NSIS_BYTES).toBe(450 * MiB);
  expect(MAX_NSIS_NON_COMPONENT_BYTES).toBe(150 * MiB);
  expect(assertNsisBudget(450 * MiB, 300 * MiB)).toMatchObject({
    installerBytes: 450 * MiB,
    componentArchiveBytes: 300 * MiB,
    nonComponentBytes: 150 * MiB,
    maxSetupBytes: 450 * MiB,
    maxNonComponentBytes: 150 * MiB,
  });
  expect(() => assertNsisBudget(450 * MiB + 1, 300 * MiB)).toThrow(/450 MiB/);
  expect(() => assertNsisBudget(400 * MiB, 250 * MiB - 1)).toThrow(/150 MiB/);
  expect(() => assertNsisBudget(400 * MiB, 300 * MiB + 1)).toThrow(/300 MiB/);
  expect(assertNsisBudget(439_171_500, 288_626_662).nonComponentBytes).toBe(150_544_838);
  expect(() => assertNsisBudget(491_244_872, 288_626_662)).toThrow(/450 MiB/);
  expect(() => assertSetupBudget(491_244_872, 288_626_662)).not.toThrow();
});

test('the NSIS final gate reads the sole updater without modifying its bytes', () => {
  const dir = root();
  const bytes = Buffer.from('final signed NSIS updater fixture');
  const name = 'Fixture-Setup-2026.7.16.exe';
  writeFileSync(path.join(dir, name), bytes);
  writeFileSync(path.join(dir, 'ZhiYuanAgent-Setup-2026.7.16.exe'), 'webview shell');
  writeFileSync(path.join(dir, 'Uninstall Fixture.exe'), 'uninstall host');
  mkdirSync(path.join(dir, 'directory.exe'));
  expect(verifyFinalNsisBudget(dir, 8)).toMatchObject({
    file: name,
    installerBytes: bytes.length,
    componentArchiveBytes: 8,
    nonComponentBytes: bytes.length - 8,
    maxSetupBytes: 450 * MiB,
  });
  expect(readFileSync(path.join(dir, name))).toEqual(bytes);
  writeFileSync(path.join(dir, 'stale-updater.exe'), bytes);
  expect(() => verifyFinalNsisBudget(dir, 8)).toThrow(/exactly one NSIS/);
  rmSync(path.join(dir, 'stale-updater.exe'));
  rmSync(path.join(dir, name));
  expect(() => verifyFinalNsisBudget(dir, 8)).toThrow(/found 0/);
});

test.each([
  [-1, 1],
  [100, 0],
  [100, 101],
  [NaN, 1],
  [100, 1.5],
])('rejects invalid installer/component byte counts %s/%s', (total, components) => {
  expect(() => assertSetupBudget(total, components)).toThrow(/byte counts/);
});

function componentsFixture() {
  const dir = root();
  const components = targets.map((target: { key: string; prefix: string }) => {
    const bytes = Buffer.from(`archive-${target.key}`);
    writeFileSync(path.join(dir, `${target.key}.7z`), bytes);
    return {
      ...target,
      archiveSizeBytes: bytes.length,
      archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ components }));
  return { dir, components };
}

test('final component deduction uses every real archive and verifies manifest size/hash', () => {
  const { dir, components } = componentsFixture();
  expect(readComponentArchiveBytes(dir)).toBe(
    components.reduce(
      (sum: number, entry: { archiveSizeBytes: number }) => sum + entry.archiveSizeBytes,
      0,
    ),
  );
  components[0].archiveSizeBytes += 1024;
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ components }));
  expect(() => readComponentArchiveBytes(dir)).toThrow(/bytes\/hash mismatch/);
});

test('rejects changed archives even if their lengths match', () => {
  const { dir, components } = componentsFixture();
  const archive = path.join(dir, `${components[0].key}.7z`);
  writeFileSync(archive, Buffer.alloc(components[0].archiveSizeBytes));
  expect(() => readComponentArchiveBytes(dir)).toThrow(/bytes\/hash mismatch/);
});

test.each(['missing', 'duplicate'])('rejects a %s component manifest entry', mode => {
  const { dir, components } = componentsFixture();
  if (mode === 'missing') components.pop();
  else components[0] = components[1];
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ components }));
  expect(() => readComponentArchiveBytes(dir)).toThrow(/seven|identity/);
});

test('forbids duplicate root VC redistributable and duplicate managed uninstall host', () => {
  const dir = root();
  const payload = path.join(dir, 'payload');
  mkdirSync(payload);
  const host = path.join(dir, 'retained-native.exe');
  writeFileSync(host, 'native NSIS bytes already verified by verifyRetainedHost');
  writeFileSync(path.join(payload, 'uninstall.exe'), readFileSync(host));
  expect(() => assertPayloadDeduplication(payload, host)).not.toThrow();
  const redist = path.join(payload, 'vc_redist.x64.exe');
  writeFileSync(redist, 'duplicate redist');
  expect(() => assertPayloadDeduplication(payload, host)).toThrow(/Duplicate VC/);
  rmSync(redist);
  writeFileSync(path.join(payload, 'uninstall.exe'), 'duplicate self-contained .NET shell');
  expect(() => assertPayloadDeduplication(payload, host)).toThrow(/never a duplicate .NET/);
  writeFileSync(path.join(payload, 'uninstall.exe'), readFileSync(host));
  writeFileSync(path.join(payload, 'ZhiYuanSetupShell.exe'), 'duplicate .NET shell');
  expect(() => assertPayloadDeduplication(payload, host)).toThrow(/duplicate payload content/);
});
