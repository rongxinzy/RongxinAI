import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');

test('blocks external will-navigate on the main window (issue #37)', () => {
  expect(source).toContain("mainWindow.webContents.on('will-navigate'");
  expect(source).toContain('void shell.openExternal(navUrl)');
  expect(source).toContain("parsed.protocol === 'file:'");
});
