import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const mainSource = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');

test('enabled channel accounts start through cc-connect, never OpenClaw gateways', () => {
  expect(mainSource).toContain('reconcileCcConnectChannelSidecars()');
  expect(mainSource).not.toContain('.startAllEnabled()');
  expect(mainSource).not.toContain('await manager.startGateway(platform)');
  expect(mainSource).not.toContain('await manager.stopGateway(platform)');
});
