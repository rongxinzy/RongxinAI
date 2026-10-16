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
    expect(
      new RegExp(`\\b${name}\\(`).test(bodyWithoutImports),
      `${name} is imported by main.ts but never called`,
    ).toBe(true);
  }
});
