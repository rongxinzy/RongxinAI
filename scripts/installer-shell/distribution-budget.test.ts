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
  MAGPIE_GATEWAY_COMPRESSED_BYTES,
  MAGPIE_GATEWAY_MARGIN_BYTES,
  MAGPIE_GATEWAY_NSIS_ALLOWANCE_BYTES,
  LLAMACPP_CPU_RUNTIME_COMPONENT_BYTES,
  LLAMACPP_CPU_RUNTIME_MARGIN_BYTES,
  LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES,
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

test('NSIS budgets: lite = original limits + Magpie allowance only, cpu equals lite, cuda uncapped', () => {
  expect(MAX_NSIS_BYTES).toBe(450 * MiB);
  expect(MAX_NSIS_NON_COMPONENT_BYTES).toBe(150 * MiB);
  expect(MAGPIE_GATEWAY_COMPRESSED_BYTES).toBe(12_334_542);
  expect(MAGPIE_GATEWAY_MARGIN_BYTES).toBe(1 * MiB);
  expect(MAGPIE_GATEWAY_NSIS_ALLOWANCE_BYTES).toBe(12_334_542 + MiB);
  const nonComponentLimit = 150 * MiB + MAGPIE_GATEWAY_NSIS_ALLOWANCE_BYTES;
  expect(resolveEditionNsisBudget('lite')).toMatchObject({
    maxInstallerBytes: 450 * MiB,
    maxComponentBytes: 300 * MiB,
    maxNonComponentBytes: nonComponentLimit,
  });
  expect(assertNsisBudget(450 * MiB, 300 * MiB, 'lite')).toMatchObject({ edition: 'lite' });
  expect(() => assertNsisBudget(450 * MiB + 1, 300 * MiB, 'lite')).toThrow(/450 MiB/);
  expect(() => assertNsisBudget(400 * MiB, 400 * MiB - nonComponentLimit - 1, 'lite')).toThrow(
    /non-component/,
  );
  // Real CI measurement with Magpie (run 39020915246): lite updater now fits.
  expect(assertNsisBudget(449_974_289, 288_942_645, 'lite').nonComponentBytes).toBe(161_031_644);
  // The NSIS updater never carries llama.cpp, so cpu gets no extra NSIS room.
  const { measured: _liteMeasured, ...liteNsis } = resolveEditionNsisBudget('lite');
  const { measured: _cpuMeasured, ...cpuNsis } = resolveEditionNsisBudget('cpu');
  expect(cpuNsis).toEqual(liteNsis);
  expect(assertNsisBudget(2048 * MiB, 300 * MiB, 'cuda')).toMatchObject({
    skipped: true,
    edition: 'cuda',
  });
});

test('the Magpie allowance does not leak into WebView2 limits', () => {
  expect(resolveEditionSetupBudget('lite').maxNonComponentBytes).toBe(220 * MiB);
  expect(resolveEditionSetupBudget('cpu').maxNonComponentBytes).toBe(220 * MiB);
});

test('WebView2 setup budget selection is per edition and derived from the llama.cpp component', () => {
  expect(LLAMACPP_CPU_RUNTIME_COMPONENT_BYTES).toBe(316_378_462 - 288_942_645);
  expect(LLAMACPP_CPU_RUNTIME_MARGIN_BYTES).toBe(2 * MiB);
  expect(LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES).toBe(
    LLAMACPP_CPU_RUNTIME_COMPONENT_BYTES + LLAMACPP_CPU_RUNTIME_MARGIN_BYTES,
  );
  expect(resolveEditionSetupBudget('lite')).toEqual({
    maxInstallerBytes: 500 * MiB,
    maxComponentBytes: 300 * MiB,
    maxNonComponentBytes: 220 * MiB,
  });
  expect(resolveEditionSetupBudget('cpu')).toEqual({
    maxInstallerBytes: 500 * MiB + LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES,
    maxComponentBytes: 300 * MiB + LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES,
    maxNonComponentBytes: 220 * MiB,
  });
  expect(resolveEditionSetupBudget('cuda')).toEqual({
    maxInstallerBytes: null,
    maxComponentBytes: null,
    maxNonComponentBytes: null,
  });
  expect(resolveEditionSetupBudget('unknown')).toEqual(resolveEditionSetupBudget('lite'));

  // Real CI measurements (run 39014993557).
  expect(() => assertSetupBudget(527_632_536, 316_378_462, 'lite')).toThrow(/300 MiB/);
  expect(assertSetupBudget(527_632_536, 316_378_462, 'cpu')).toMatchObject({ edition: 'cpu' });
  expect(assertSetupBudget(500_213_656, 288_942_645, 'lite')).toMatchObject({ edition: 'lite' });
  // cpu only gains the llama.cpp allowance: anything beyond it still fails.
  const cpu = resolveEditionSetupBudget('cpu');
  expect(() => assertSetupBudget(400 * MiB, cpu.maxComponentBytes + 1, 'cpu')).toThrow(
    /component|Component/,
  );
  expect(() => assertSetupBudget(cpu.maxInstallerBytes + 1, 300 * MiB, 'cpu')).toThrow(/MiB/);
  expect(() => assertSetupBudget(220 * MiB + 1 + 10, 10, 'cpu')).toThrow(/220 MiB/);
  expect(assertSetupBudget(4096 * MiB, 3000 * MiB, 'cuda')).toMatchObject({ edition: 'cuda' });
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

test('NSIS deduction sums the fixed lite components even when cpu/cuda add llama.cpp', () => {
  const { dir, components } = componentsFixture();
  const liteTotal = components.reduce(
    (sum: number, entry: { archiveSizeBytes: number }) => sum + entry.archiveSizeBytes,
    0,
  );
  const extra = Buffer.from('archive-llamacpp-bundled');
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), extra);
  const withRuntime = [
    ...components,
    {
      key: 'llamacpp-bundled',
      prefix: 'llamacpp-bundled',
      archiveSizeBytes: extra.length,
      archiveSha256: createHash('sha256').update(extra).digest('hex'),
    },
  ];
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ components: withRuntime }));
  expect(readNsisUpdaterComponentDeductionBytes(dir)).toBe(liteTotal);
  // The strict lite read still rejects a manifest that does not match exactly.
  expect(() => readComponentArchiveBytes(dir, 'lite')).toThrow(/every bundled Windows component/);
});
