import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// The main-process bootstrap lives in main.ts plus the appBootstrap/ modules it
// wires together; channel runtime wiring must be checked across all of them.
const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const appBootstrapDir = fileURLToPath(new URL('./appBootstrap', import.meta.url));
const appBootstrapSources = readdirSync(appBootstrapDir)
  .filter(fileName => fileName.endsWith('.ts') && !fileName.endsWith('.test.ts'))
  .map(fileName => readFileSync(`${appBootstrapDir}/${fileName}`, 'utf8'))
  .join('\n');

const mainSource = `${readSource('./main.ts')}\n${appBootstrapSources}`;

test('enabled channel accounts start only through cc-connect sidecars', () => {
  expect(mainSource).toContain('reconcileCcConnectChannelSidecars()');
  expect(mainSource).not.toContain('.startAllEnabled()');
  expect(mainSource).not.toContain('await manager.startGateway(platform)');
  expect(mainSource).not.toContain('await manager.stopGateway(platform)');
});
