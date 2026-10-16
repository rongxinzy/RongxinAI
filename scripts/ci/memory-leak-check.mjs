import { mkdtemp, mkdir, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
  if (process.platform === 'win32') {
    return path.join(projectDirectory, 'node_modules/electron/dist/electron.exe');
  }
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
await Promise.all(
  ['AppData/Roaming', 'AppData/Local', 'user-data'].map(directory =>
    mkdir(path.join(isolatedHome, directory), { recursive: true }),
  ),
);
const provider = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.end(JSON.stringify({ data: [{ id: 'memory-test-model', object: 'model' }] }));
  } else {
    response.writeHead(404);
    response.end('{}');
  }
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
let electronApp;
try {
  electronApp = await electron.launch({
    executablePath: resolveElectronExecutable(),
    args: [projectDirectory, '--no-sandbox', '--js-flags=--expose-gc'],
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      APPDATA: path.join(isolatedHome, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(isolatedHome, 'AppData', 'Local'),
      XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
      XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
      XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
      ZHIYUAN_MEMORY_LEAK_TEST: '1',
      ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: path.join(isolatedHome, 'user-data'),
    },
  });

  const page = await electronApp.firstWindow();
  await page
    .getByTestId('sidebar-new-conversation')
    .waitFor({ state: 'visible', timeout: 120_000 });

  // Use the same verified runtime, provider management API and selected catalog
  // model as the product. No legacy config or readiness bypass is seeded.
  const started = await page.evaluate(() => window.electron.magpie.start());
  if (started.state !== 'running') throw new Error('Memory test model service did not start.');
  const managementWindow = electronApp.waitForEvent('window');
  await page.evaluate(() => window.electron.magpie.openManagement());
  const management = await managementWindow;
  await management.waitForLoadState('domcontentloaded');
  const saved = await management.evaluate(async baseUrl => {
    const response = await fetch('/api/provider/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'memory-test',
        from: 'memory-test',
        name: 'Memory Test',
        new: true,
        chat: baseUrl,
        responses: '',
        anthropic: '',
        key: 'memory-test-key',
        models: ['memory-test-model'],
        proxy: 'direct',
        unredacted: true,
        contexts: {},
        outputs: {},
        modelPrefs: {},
        headers: {},
        extraBody: {},
        fallback: [],
      }),
    });
    return response.ok;
  }, `http://127.0.0.1:${provider.address().port}/v1`);
  if (!saved) throw new Error('Memory test provider registration failed.');
  await management.close();
  await page.evaluate(() => window.electron.magpie.selectDefault('memory-test/memory-test-model'));
  const readiness = await page.evaluate(() => window.electron.checkApiConfig());
  if (!readiness.hasConfig) throw new Error(`Memory test model setup failed: ${readiness.error}`);

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
} catch (error) {
  for (const entry of await readdir(isolatedHome, { recursive: true })) {
    if (/main(?:-dev)?-.*\.log$/.test(entry)) {
      await copyFile(
        path.join(isolatedHome, entry),
        path.join(diagnosticsDirectory, path.basename(entry)),
      );
    }
  }
  throw error;
} finally {
  try {
    await electronApp?.close();
  } finally {
    await new Promise(resolve => provider.close(resolve));
    await rm(isolatedHome, { recursive: true, force: true });
  }
}
