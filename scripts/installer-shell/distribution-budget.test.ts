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
  UNCAPPED_EDITIONS,
  BUNDLED_RUNTIME_EDITIONS,
  isUncappedEdition,
  bundlesRuntimeComponent,
  resolveEditionSetupBudget,
  resolveEditionNsisBudget,
  assertSetupBudget,
  assertNsisBudget,
  readComponentArchiveBytes,
  assertPayloadDeduplication,
  verifyFinalNsisBudget,
  readNsisUpdaterComponentDeductionBytes,
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

test.each(['lite', 'cpu', 'cuda'])(
  '%s reports arbitrarily large installer/component bytes without a size failure',
  edition => {
    expect([...UNCAPPED_EDITIONS]).toContain(edition);
    expect(isUncappedEdition(edition)).toBe(true);
    const limits = { maxInstallerBytes: null, maxComponentBytes: null, maxNonComponentBytes: null };
    expect(resolveEditionSetupBudget(edition)).toEqual(limits);
    expect(resolveEditionNsisBudget(edition)).toMatchObject(limits);
    for (const check of [assertSetupBudget, assertNsisBudget]) {
      expect(check(8192 * MiB, 4096 * MiB, edition)).toMatchObject({
        edition,
        uncapped: true,
        installerBytes: 8192 * MiB,
        componentArchiveBytes: 4096 * MiB,
        nonComponentBytes: 4096 * MiB,
        maxSetupBytes: null,
        maxComponentBytes: null,
        maxNonComponentBytes: null,
      });
      expect(() => check(100, 101, edition)).toThrow(/byte counts/);
    }
  },
);

test('no default distribution ceiling remains and runtime editions stay explicit', () => {
  for (const value of [
    MAX_SETUP_BYTES,
    MAX_COMPONENT_BYTES,
    MAX_NON_COMPONENT_BYTES,
    MAX_NSIS_BYTES,
    MAX_NSIS_NON_COMPONENT_BYTES,
  ])
    expect(value).toBeNull();
  expect(resolveEditionSetupBudget('unknown').maxInstallerBytes).toBeNull();
  expect([...BUNDLED_RUNTIME_EDITIONS].sort()).toEqual(['cpu', 'cuda']);
  expect(bundlesRuntimeComponent('lite')).toBe(false);
  expect(bundlesRuntimeComponent('cpu')).toBe(true);
  expect(bundlesRuntimeComponent('cuda')).toBe(true);
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
    maxSetupBytes: null,
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
  expect(() => readComponentArchiveBytes(dir)).toThrow(/every bundled|identity/);
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

function bundledRuntimeEntries(dir: string, edition: 'cpu' | 'cuda') {
  const entries: Array<{
    key: string;
    prefix: string;
    archiveSizeBytes: number;
    archiveSha256: string;
  }> = [];
  const llamacppBytes = Buffer.from('archive-llamacpp-bundled');
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), llamacppBytes);
  entries.push({
    key: 'llamacpp-bundled',
    prefix: 'llamacpp-bundled',
    archiveSizeBytes: llamacppBytes.length,
    archiveSha256: createHash('sha256').update(llamacppBytes).digest('hex'),
  });
  if (edition === 'cuda') {
    const strataBytes = Buffer.from('archive-strata-bundled');
    writeFileSync(path.join(dir, 'strata-bundled.7z'), strataBytes);
    entries.push({
      key: 'strata-bundled',
      prefix: 'strata-bundled',
      archiveSizeBytes: strataBytes.length,
      archiveSha256: createHash('sha256').update(strataBytes).digest('hex'),
    });
  }
  return entries;
}

test('NSIS deduction includes and verifies the bundled runtime for cpu/cuda', () => {
  const { dir, components } = componentsFixture();
  const liteTotal = components.reduce(
    (sum: number, entry: { archiveSizeBytes: number }) => sum + entry.archiveSizeBytes,
    0,
  );
  for (const edition of ['cpu', 'cuda'] as const) {
    const bundled = bundledRuntimeEntries(dir, edition);
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ components: [...components, ...bundled] }),
    );
    const bundledTotal = bundled.reduce((sum, entry) => sum + entry.archiveSizeBytes, 0);
    expect(readNsisUpdaterComponentDeductionBytes(dir, edition)).toBe(liteTotal + bundledTotal);
  }
  const llamacppBytes = Buffer.from('archive-llamacpp-bundled');
  const cpuBundledForIntegrity = bundledRuntimeEntries(dir, 'cpu');
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ components: [...components, ...cpuBundledForIntegrity] }),
  );
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), Buffer.alloc(llamacppBytes.length));
  expect(() => readNsisUpdaterComponentDeductionBytes(dir, 'cpu')).toThrow(/bytes\/hash mismatch/);
  // The strict lite read still rejects a manifest that does not match exactly.
  expect(() => readComponentArchiveBytes(dir, 'lite')).toThrow(/every bundled Windows component/);
});

test('llama.cpp editions require the fixed set, verify and count extra components', () => {
  const { dir, components } = componentsFixture();
  const liteTotal = components.reduce(
    (sum: number, entry: { archiveSizeBytes: number }) => sum + entry.archiveSizeBytes,
    0,
  );
  for (const edition of ['cpu', 'cuda'] as const) {
    const bundled = bundledRuntimeEntries(dir, edition);
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ components: [...components, ...bundled] }),
    );
    const bundledTotal = bundled.reduce((sum, entry) => sum + entry.archiveSizeBytes, 0);
    expect(readComponentArchiveBytes(dir, edition)).toBe(liteTotal + bundledTotal);
  }
  const llamacppBytes = Buffer.from('archive-llamacpp-bundled');
  const cpuBundledForIntegrity = bundledRuntimeEntries(dir, 'cpu');
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ components: [...components, ...cpuBundledForIntegrity] }),
  );
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), Buffer.alloc(llamacppBytes.length));
  expect(() => readComponentArchiveBytes(dir, 'cpu')).toThrow(/bytes\/hash mismatch/);
  // A missing fixed component is a broken install, in every edition.
  const cpuBundled = bundledRuntimeEntries(dir, 'cpu');
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), llamacppBytes);
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ components: [...components.slice(1), ...cpuBundled] }),
  );
  expect(() => readComponentArchiveBytes(dir, 'cpu')).toThrow(/every bundled|identity/);
});

test.each(['cpu', 'cuda'])(
  '%s rejects an absent bundled runtime even with all seven base components',
  edition => {
    const { dir } = componentsFixture();
    expect(() => readComponentArchiveBytes(dir, edition)).toThrow(/every bundled/);
  },
);
