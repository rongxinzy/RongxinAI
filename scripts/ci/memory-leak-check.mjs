import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const CYCLE_COUNT = 20;
const SAMPLE_COUNT = 5;
const SAMPLE_DELAY_MS = 250;
const MAIN_HEAP_TOLERANCE_BYTES = 16 * 1024 * 1024;
const RENDERER_HEAP_TOLERANCE_BYTES = 12 * 1024 * 1024;
const diagnosticsDirectory = path.resolve(
  process.env.MEMORY_LEAK_ARTIFACT_DIR ?? 'artifacts/memory-leak',
);
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const median = values => {
  const sortedValues = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2
    : sortedValues[midpoint];
};

const thresholdFor = (baseline, absoluteTolerance) =>
  baseline + Math.max(absoluteTolerance, Math.round(baseline * 0.25));

const resolveElectronExecutable = () => {
  if (process.platform === 'darwin') {
    return path.join(
      projectDirectory,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    );
  }

  return path.join(projectDirectory, 'node_modules/electron/dist/electron');
};

const collectMetrics = async electronApp =>
  electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Main window is unavailable.');

    const contents = window.webContents;
    const attachedHere = !contents.debugger.isAttached();
    if (attachedHere) contents.debugger.attach('1.3');

    try {
      await contents.debugger.sendCommand('HeapProfiler.collectGarbage');
      const rendererHeap = await contents.debugger.sendCommand('Runtime.getHeapUsage');
      const mainMemory = process.memoryUsage();
      return {
        mainHeapUsed: mainMemory.heapUsed,
        rendererHeapUsed: rendererHeap.usedSize,
      };
    } finally {
      if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
    }
  });

const sampleMetrics = async electronApp => {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(await collectMetrics(electronApp));
    await delay(SAMPLE_DELAY_MS);
  }
  return samples;
};

const takeSnapshots = async (electronApp, phase) => {
  const mainSnapshot = path.join(diagnosticsDirectory, `main-${phase}.heapsnapshot`);
  const rendererSnapshot = path.join(diagnosticsDirectory, `renderer-${phase}.heapsnapshot`);
  await electronApp.evaluate(
    async ({ BrowserWindow }, paths) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error('Main window is unavailable.');

      process.takeHeapSnapshot(paths.mainSnapshot);
      await window.webContents.takeHeapSnapshot(paths.rendererSnapshot);
    },
    { mainSnapshot, rendererSnapshot },
  );
  return { mainSnapshot, rendererSnapshot };
};

const dismissBlockingDialog = async page => {
  const overlay = page.locator('[data-slot="dialog-overlay"]').first();
  if (!(await overlay.isVisible().catch(() => false))) return;

  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 5_000 });
};

const runCycles = async page => {
  const activity = page.getByTestId('sidebar-view-activity');
  const cowork = page.getByTestId('sidebar-new-conversation');
  for (let index = 0; index < CYCLE_COUNT; index += 1) {
    await dismissBlockingDialog(page);
    await activity.click();
    await page.locator('[data-active-view="activity"]').waitFor({ state: 'visible' });
    await cowork.click();
    await page.locator('[data-active-view="cowork"]').waitFor({ state: 'visible' });
    await delay(SAMPLE_DELAY_MS);
  }
};

await mkdir(diagnosticsDirectory, { recursive: true });
const isolatedHome = await mkdtemp(path.join(os.tmpdir(), 'zhiyuan-memory-leak-'));
const electronApp = await electron.launch({
  executablePath: resolveElectronExecutable(),
  args: [projectDirectory, '--no-sandbox', '--js-flags=--expose-gc'],
  env: {
    ...process.env,
    HOME: isolatedHome,
    XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
    XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
    XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
    ZHIYUAN_MEMORY_LEAK_TEST: '1',
    ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: path.join(isolatedHome, 'user-data'),
  },
});

try {
  const page = await electronApp.firstWindow();
  await page
    .getByTestId('sidebar-new-conversation')
    .waitFor({ state: 'visible', timeout: 120_000 });

  const baselineSnapshots = await takeSnapshots(electronApp, 'before');
  const baselineSamples = await sampleMetrics(electronApp);
  await runCycles(page);
  const finalSamples = await sampleMetrics(electronApp);
  const finalSnapshots = await takeSnapshots(electronApp, 'after');

  const baseline = {
    mainHeapUsed: median(baselineSamples.map(sample => sample.mainHeapUsed)),
    rendererHeapUsed: median(baselineSamples.map(sample => sample.rendererHeapUsed)),
  };
  const final = {
    mainHeapUsed: median(finalSamples.map(sample => sample.mainHeapUsed)),
    rendererHeapUsed: median(finalSamples.map(sample => sample.rendererHeapUsed)),
  };
  const thresholds = {
    mainHeapUsed: thresholdFor(baseline.mainHeapUsed, MAIN_HEAP_TOLERANCE_BYTES),
    rendererHeapUsed: thresholdFor(baseline.rendererHeapUsed, RENDERER_HEAP_TOLERANCE_BYTES),
  };
  const report = {
    cycles: CYCLE_COUNT,
    baselineSamples,
    finalSamples,
    baseline,
    final,
    thresholds,
    snapshots: { before: baselineSnapshots, after: finalSnapshots },
  };
  await writeFile(
    path.join(diagnosticsDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const exceededMetrics = Object.entries(thresholds).filter(
    ([metric, threshold]) => final[metric] > threshold,
  );
  if (exceededMetrics.length > 0) {
    throw new Error(
      `Memory regression after ${CYCLE_COUNT} Cowork view cycles: ${exceededMetrics
        .map(([metric, threshold]) => `${metric}=${final[metric]} > ${threshold}`)
        .join(', ')}. Heap snapshots are available in ${diagnosticsDirectory}.`,
    );
  }

  console.log(`Memory leak check passed after ${CYCLE_COUNT} Cowork view cycles.`);
} finally {
  await electronApp.close();
}
