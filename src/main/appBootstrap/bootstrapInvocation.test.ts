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

test('initApp makes the native automation tool available before the first window', () => {
  const source = readSource('./initApp.ts');
  const eagerCall = source.indexOf(
    'getPiRuntimeAdapter().setScheduledTaskService(getScheduledTaskService());',
  );
  const createWindow = source.indexOf('createMainWindow();');
  expect(eagerCall).toBeGreaterThan(-1);
  expect(createWindow).toBeGreaterThan(eagerCall);
});

test('native recovery starts after model MCP and managed resources are ready', () => {
  const source = readSource('./initApp.ts');
  const mcpReady = source.indexOf('await initMcpServers();');
  const resourcesReady = source.indexOf('await Promise.all([');
  const nativeReady = source.indexOf('await markNativeResourcesReady();');
  expect(mcpReady).toBeGreaterThan(-1);
  expect(resourcesReady).toBeGreaterThan(mcpReady);
  expect(nativeReady).toBeGreaterThan(resourcesReady);
  expect(source).not.toContain('recoverInterruptedRuns(');
  const recovery = readSource('./nativeRecovery.ts');
  const recover = recovery.indexOf('await getPiRuntimeAdapter().recoverSessions();');
  const automations = recovery.indexOf('await startAutomations();');
  const retryParked = recovery.indexOf('await getScheduledTaskService().retryParked();');
  expect(recover).toBeGreaterThan(-1);
  expect(automations).toBeGreaterThan(recover);
  expect(retryParked).toBeGreaterThan(automations);
  expect(recovery).toContain('await recoverNativeRuntimes();');
});

test('native automation startup injects its service before resuming durable tasks', () => {
  const source = readSource('./automationRuntime.ts');
  expect(source).toContain('new DurableAutomationService(');
  const startup = source.slice(source.indexOf('export async function startAutomations'));
  const injection = startup.indexOf('getPiRuntimeAdapter().setScheduledTaskService(current);');
  const start = startup.indexOf('await current.start();');
  expect(injection).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(injection);
});

test('bootstrap registers local workbench todo and coding IPC before opening a window', () => {
  const source = readSource('./initApp.ts');
  const createWindow = source.indexOf('createMainWindow();');
  for (const registration of [
    'registerWorkbenchTaskIpcHandlers({',
    'registerTodoIpcHandlers(',
    'registerCodingAgentIpcHandlers(getCodingRoomService)',
  ]) {
    const invocation = source.indexOf(registration);
    expect(invocation, `${registration} must be invoked during bootstrap`).toBeGreaterThan(-1);
    expect(invocation, `${registration} must run before the first window`).toBeLessThan(
      createWindow,
    );
  }
});
