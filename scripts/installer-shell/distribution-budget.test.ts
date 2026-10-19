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
  UNCAPPED_EDITIONS,
  BUNDLED_RUNTIME_EDITIONS,
  isUncappedEdition,
  bundlesRuntimeComponent,
  CPU_SETUP_MEASURED,
  CPU_SETUP_MARGIN,
  CPU_NSIS_MEASURED,
  CPU_NSIS_MARGIN,
  CPU_COMPONENT_MEASURED,
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

test('NSIS budgets: lite = original limits + Magpie allowance only', () => {
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
  expect(assertNsisBudget(450 * MiB, 300 * MiB, 'lite')).toMatchObject({
    edition: 'lite',
    uncapped: false,
  });
  expect(() => assertNsisBudget(450 * MiB + 1, 300 * MiB, 'lite')).toThrow(/450 MiB/);
  expect(() => assertNsisBudget(400 * MiB, 400 * MiB - nonComponentLimit - 1, 'lite')).toThrow(
    /non-component/,
  );
  // Real CI measurement with Magpie (run 39020915246): lite updater now fits.
  expect(assertNsisBudget(449_974_289, 288_942_645, 'lite').nonComponentBytes).toBe(161_031_644);
});

test('lite WebView2 keeps its original limits; the Magpie allowance does not leak into them', () => {
  expect(MAX_SETUP_BYTES).toBe(500 * MiB);
  expect(resolveEditionSetupBudget('lite')).toEqual({
    maxInstallerBytes: 500 * MiB,
    maxComponentBytes: 300 * MiB,
    maxNonComponentBytes: 220 * MiB,
  });
  expect(resolveEditionSetupBudget('unknown')).toEqual(resolveEditionSetupBudget('lite'));
  // Real CI measurements (run 39014993557): a cpu-sized build fails lite.
  expect(() => assertSetupBudget(527_632_536, 316_378_462, 'lite')).toThrow(/300 MiB/);
  expect(assertSetupBudget(500_213_656, 288_942_645, 'lite')).toMatchObject({ edition: 'lite' });
});

// cpu limits = measured (build run 39032801288) + ceil(3%) whole-MiB margin.
// Changing them requires a new measured run, never a round-number bump.
test('cpu WebView2 keeps total limits and recalibrates measured component bytes', () => {
  expect(CPU_SETUP_MEASURED).toEqual({
    installerBytes: 527_673_448,
    componentArchiveBytes: 316_397_703,
    nonComponentBytes: 211_275_745,
  });
  expect(CPU_SETUP_MARGIN).toEqual({
    installerBytes: 16 * MiB,
    componentArchiveBytes: 10 * MiB,
    nonComponentBytes: 7 * MiB,
  });
  for (const key of Object.keys(CPU_SETUP_MEASURED) as (keyof typeof CPU_SETUP_MEASURED)[]) {
    const margin = CPU_SETUP_MARGIN[key];
    expect(margin).toBe(Math.ceil((CPU_SETUP_MEASURED[key] * 0.03) / MiB) * MiB);
  }
  const limits = resolveEditionSetupBudget('cpu');
  expect(limits).toEqual({
    maxInstallerBytes: 544_450_664,
    maxComponentBytes: 339_820_025,
    maxNonComponentBytes: 218_615_777,
  });
  // The measured cpu build passes its own limits.
  expect(assertSetupBudget(527_673_448, 316_397_703, 'cpu')).toMatchObject({
    edition: 'cpu',
    uncapped: false,
    nonComponentBytes: 211_275_745,
  });
  expect(() =>
    assertSetupBudget(limits.maxInstallerBytes + 1, limits.maxComponentBytes, 'cpu'),
  ).toThrow(/519\.2 MiB/);
  expect(() => assertSetupBudget(500 * MiB, limits.maxComponentBytes + 1, 'cpu')).toThrow(
    /324\.1 MiB budget/,
  );
  expect(() => assertSetupBudget(limits.maxNonComponentBytes + 1 + MiB, MiB, 'cpu')).toThrow(
    /non-component bytes exceed the 208\.5 MiB/,
  );
});

test('cpu NSIS keeps total limits and recalibrates measured component bytes', () => {
  expect(CPU_NSIS_MEASURED).toEqual({
    installerBytes: 450_027_196,
    componentArchiveBytes: 288_987_169,
    nonComponentBytes: 161_040_027,
  });
  expect(CPU_NSIS_MARGIN).toEqual({
    installerBytes: 13 * MiB,
    componentArchiveBytes: 9 * MiB,
    nonComponentBytes: 5 * MiB,
  });
  for (const key of Object.keys(CPU_NSIS_MEASURED) as (keyof typeof CPU_NSIS_MEASURED)[]) {
    expect(CPU_NSIS_MARGIN[key]).toBe(Math.ceil((CPU_NSIS_MEASURED[key] * 0.03) / MiB) * MiB);
  }
  const limits = resolveEditionNsisBudget('cpu');
  expect(limits).toMatchObject({
    maxInstallerBytes: 463_658_684,
    maxComponentBytes: 311_360_919,
    maxNonComponentBytes: 166_282_907,
    measured: CPU_NSIS_MEASURED,
  });
  expect(assertNsisBudget(450_027_196, 288_987_169, 'cpu')).toMatchObject({
    edition: 'cpu',
    uncapped: false,
    nonComponentBytes: 161_040_027,
  });
  expect(() => assertNsisBudget(limits.maxInstallerBytes + 1, 280 * MiB, 'cpu')).toThrow(
    /442\.2 MiB/,
  );
  expect(() => assertNsisBudget(400 * MiB, limits.maxComponentBytes + 1, 'cpu')).toThrow(
    /296\.9 MiB/,
  );
  expect(() =>
    assertNsisBudget(280 * MiB + limits.maxNonComponentBytes + 1, 280 * MiB, 'cpu'),
  ).toThrow(/non-component/);
});

test('build.9 relocatable Python fits recalibrated CPU components within the original total limits', () => {
  expect(CPU_COMPONENT_MEASURED).toEqual({ setup: 329_334_265, nsis: 301_923_735 });
  for (const [measured, limits] of [
    [CPU_COMPONENT_MEASURED.setup, resolveEditionSetupBudget('cpu')],
    [CPU_COMPONENT_MEASURED.nsis, resolveEditionNsisBudget('cpu')],
  ] as const) {
    expect(limits.maxComponentBytes).toBe(measured + Math.ceil((measured * 0.03) / MiB) * MiB);
  }
  expect(assertSetupBudget(540_166_608, CPU_COMPONENT_MEASURED.setup, 'cpu')).toMatchObject({
    maxSetupBytes: 544_450_664,
    maxNonComponentBytes: 218_615_777,
  });
  expect(assertNsisBudget(462_543_176, CPU_COMPONENT_MEASURED.nsis, 'cpu')).toMatchObject({
    maxSetupBytes: 463_658_684,
    maxNonComponentBytes: 166_282_907,
  });
});

// cuda is publicly released with NO size limit (krli decision); integrity only.
test('cuda is uncapped: sizes are measured, never rejected', () => {
  expect([...UNCAPPED_EDITIONS]).toEqual(['cuda']);
  expect(isUncappedEdition('cuda')).toBe(true);
  const none = { maxInstallerBytes: null, maxComponentBytes: null, maxNonComponentBytes: null };
  expect(resolveEditionSetupBudget('cuda')).toEqual(none);
  expect(resolveEditionNsisBudget('cuda')).toMatchObject(none);
  expect(assertSetupBudget(4096 * MiB, 3000 * MiB, 'cuda')).toMatchObject({
    edition: 'cuda',
    uncapped: true,
    installerBytes: 4096 * MiB,
    componentArchiveBytes: 3000 * MiB,
    nonComponentBytes: 1096 * MiB,
  });
  expect(assertNsisBudget(2048 * MiB, 300 * MiB, 'cuda')).toMatchObject({
    edition: 'cuda',
    uncapped: true,
    nonComponentBytes: 1748 * MiB,
  });
  // Byte-count validity is correctness, not a budget: still enforced.
  expect(() => assertSetupBudget(100, 101, 'cuda')).toThrow(/byte counts/);
});

test('only cuda is uncapped; cpu and cuda bundle the optional llama.cpp component', () => {
  expect(isUncappedEdition('lite')).toBe(false);
  expect(isUncappedEdition('cpu')).toBe(false);
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

test('llama.cpp editions require the fixed set, verify and count extra components', () => {
  const { dir, components } = componentsFixture();
  const liteTotal = components.reduce(
    (sum: number, entry: { archiveSizeBytes: number }) => sum + entry.archiveSizeBytes,
    0,
  );
  const extra = Buffer.from('archive-llamacpp-bundled');
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), extra);
  const extraEntry = {
    key: 'llamacpp-bundled',
    prefix: 'llamacpp-bundled',
    archiveSizeBytes: extra.length,
    archiveSha256: createHash('sha256').update(extra).digest('hex'),
  };
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ components: [...components, extraEntry] }),
  );
  expect(readComponentArchiveBytes(dir, 'cpu')).toBe(liteTotal + extra.length);
  expect(readComponentArchiveBytes(dir, 'cuda')).toBe(liteTotal + extra.length);
  // Integrity of the extra component is still enforced.
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), Buffer.alloc(extra.length));
  expect(() => readComponentArchiveBytes(dir, 'cpu')).toThrow(/bytes\/hash mismatch/);
  // A missing fixed component is a broken install, in every edition.
  writeFileSync(path.join(dir, 'llamacpp-bundled.7z'), extra);
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ components: [...components.slice(1), extraEntry] }),
  );
  expect(() => readComponentArchiveBytes(dir, 'cpu')).toThrow(/identity/);
});
