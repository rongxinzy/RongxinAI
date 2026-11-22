import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// The main-process bootstrap was split from main.ts into ./appBootstrap/ modules.
// These tests pin the invocation wiring of that split: every extracted body must
// actually be called. The original split shipped wrappers that only declared
// their inner function (`export const initApp = async () => { const run = ...; };`
// without calling it), which left the app booting without a window and failed
// the CI memory-leak scenario.
const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

test('initApp awaits the extracted bootstrap body', () => {
  const source = readSource('./initApp.ts');

  // The startup body (app.whenReady onwards) must live inside runInitApp and
  // the exported initApp must actually await it before returning.
  const bodyStart = source.indexOf('await app.whenReady()');
  const invocation = source.indexOf('await runInitApp();');
  expect(bodyStart).toBeGreaterThan(-1);
  expect(invocation).toBeGreaterThan(bodyStart);
  expect(source.trimEnd().endsWith('};')).toBe(true);
});

test('createMainWindow invokes the extracted window-creation body', () => {
  const source = readSource('./mainWindow.ts');

  const bodyStart = source.indexOf('new BrowserWindow(');
  const invocation = source.indexOf('createWindow();');
  expect(bodyStart).toBeGreaterThan(-1);
  expect(invocation).toBeGreaterThan(bodyStart);
});

test('main.ts invokes every appBootstrap helper it imports', () => {
  const mainSource = readSource('../main.ts');
  const importStatements = [
    ...mainSource.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'(\.\/appBootstrap\/[^']+)';/gm),
  ];
  const importedNames = importStatements
    .flatMap(match => match[1].split(','))
    .map(name => name.trim())
    .filter(name => name.length > 0 && !name.startsWith('type '));

  expect(importedNames.length).toBeGreaterThan(10);

  const bodyWithoutImports = mainSource.replace(/^import[\s\S]*?from\s*'[^']+';/gm, '');
  for (const name of importedNames) {
    // Called (`helper()`) or referenced as a value (composition-root wiring
    // hands helpers to `registerXxxIpc({ dep: helper })` without calling
    // them in main.ts). Either form proves the import is used; a bare name
    // in neither position is the dead-wrapper regression this guards against.
    const used =
      new RegExp(`\\b${name}\\(`).test(bodyWithoutImports) ||
      new RegExp(`\\b${name}\\b\\s*[,}).\\n]`).test(bodyWithoutImports);
    expect(used, `${name} is imported by main.ts but never used`).toBe(true);
  }
});

test('initApp imports schedules and recovers interrupted runs before opening the window, Channel and Cron', () => {
  const source = readSource('./initApp.ts');
  const recoverWork = source.search(/=\s*recoverInterruptedWork\(/);
  const startChannel = source.indexOf('reconcileCcConnectChannelSidecars().catch');
  const armSchedules = source.indexOf(
    'await getCanonicalScheduledTaskService().armSavedSchedules();',
  );
  const createWindow = source.indexOf('createMainWindow();');
  const openStore = source.indexOf('store = await initStore()');
  expect(openStore).toBeGreaterThan(-1);
  const importTasks = source.indexOf('await migrateLegacyScheduledTasksToCanonical(migration)');
  const importRuns = source.indexOf('await migrateLegacyScheduledTaskRunsToCanonical(migration)');
  expect(importTasks).toBeGreaterThan(openStore);
  expect(importRuns).toBeGreaterThan(importTasks);
  expect(recoverWork).toBeGreaterThan(importRuns);
  expect(source.indexOf('void startSqliteBackupLoop().catch')).toBeGreaterThan(recoverWork);
  expect(createWindow).toBeGreaterThan(recoverWork);
  expect(startChannel).toBeGreaterThan(createWindow);
  expect(armSchedules).toBeGreaterThan(startChannel);
});

test('initApp prepares the shared Pi runtime before opening Channel or arming Cron', () => {
  const source = readSource('./initApp.ts');
  const config = source.indexOf("profiler.measure('enterpriseConfigSync')");
  const mcp = source.indexOf('ensureBuiltInMcpDefaultsDisabled();');
  const codingRoom = source.indexOf(
    'codingRoomRuntime.start(magpie.modelService, piRuntime, codingRepository)',
  );
  const binding = source.indexOf('bindPiWorkbenchRuntimeForwarder(piRuntime,');
  const channel = source.indexOf('void channelDelivery.trackStartup(');
  const model = source.indexOf('await magpie.start();');
  const cron = source.indexOf('await getCanonicalScheduledTaskService().armSavedSchedules();');
  const quitCheck = 'if (lifecycleRuntime.isQuitting) return;';

  expect(config).toBeGreaterThan(-1);
  expect(mcp).toBeGreaterThan(config);
  expect(codingRoom).toBeGreaterThan(mcp);
  expect(binding).toBeGreaterThan(codingRoom);
  expect(source).toContain('const channelDelivery = getCcConnectDeliveryTransport();');
  expect(source).toContain('initializeSessionRuntime(magpie.modelService, channelDelivery)');
  expect(source.indexOf('localInference.start(magpie);')).toBeGreaterThan(-1);
  expect(channel).toBeGreaterThan(source.indexOf('localInference.start(magpie);'));
  expect(channel).toBeGreaterThan(binding);
  expect(model).toBeGreaterThan(channel);
  expect(cron).toBeGreaterThan(model);
  expect(source.slice(model, cron)).toContain(quitCheck);
  expect(source).not.toContain('channelStartup');
});

test('initApp checks for quit after applying proxy settings and shows the window before waiting for Magpie', () => {
  const source = readSource('./initApp.ts');
  const proxy = source.indexOf('await applyProxyPreference(');
  const quit = source.indexOf('if (lifecycleRuntime.isQuitting) return;', proxy);
  const window = source.indexOf('createMainWindow();', quit);
  const magpie = source.indexOf('await magpie.start();', proxy);
  expect(proxy).toBeGreaterThan(-1);
  expect(quit).toBeGreaterThan(proxy);
  expect(window).toBeGreaterThan(quit);
  expect(magpie).toBeGreaterThan(window);
});

test('initApp waits for Windows taskbar identity before creating its window', () => {
  const source = readSource('./initApp.ts');
  const prepare = source.indexOf('await prepareWindowsTaskbarIdentity();');
  const handleProtocol = source.indexOf('protocol.handle(ZHIYUAN_ENTERPRISE_RENDERER_SCHEME');
  const createWindow = source.indexOf('createMainWindow();');
  expect(prepare).toBeGreaterThan(-1);
  expect(handleProtocol).toBeGreaterThan(prepare);
  expect(createWindow).toBeGreaterThan(handleProtocol);
  expect(source.slice(prepare, handleProtocol)).toContain(
    'if (lifecycleRuntime.isQuitting) return;',
  );
});
