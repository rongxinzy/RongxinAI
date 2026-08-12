import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const mainSource = readSource('../../main.ts');
const coworkViewSource = readSource('../../../renderer/components/cowork/CoworkView.tsx');
const coworkServiceSource = readSource('../../../renderer/services/cowork.ts');
const piRuntimeAdapterSource = readSource('./piRuntimeAdapter.ts');
const ccConnectPiBridgeSource = readSource('../../im/ccConnectPiBridge.ts');
const runtimeTypesSource = readSource('./types.ts');

describe('Pi runtime isolation', () => {
  test('Pi is the sole agent runtime contract', () => {
    expect(piRuntimeAdapterSource).not.toContain("from './types'");
    expect(piRuntimeAdapterSource).not.toContain('CoworkRuntime');
    expect(piRuntimeAdapterSource).toContain('implements PiRuntime');
    expect(runtimeTypesSource).toContain('PiRuntime');
    expect(runtimeTypesSource).not.toContain('CoworkRuntime');
  });

  test('projects only Pi runtime events into cowork streams', () => {
    expect(mainSource).toContain('forwardPiWorkbenchRuntimeToRenderer(getPiRuntimeAdapter())');
    expect(mainSource).not.toContain('OpenClawChannelGateway');
    expect(mainSource).not.toContain('OpenClawEngineManager');
    expect(mainSource).not.toContain("webContents.send('cowork:stream:");
  });

  test('routes cc-connect turns directly into Pi', () => {
    expect(ccConnectPiBridgeSource).toContain('runtime: PiRuntimeAdapter');
    expect(ccConnectPiBridgeSource).toContain('coworkRuntime: options.runtime');
    expect(ccConnectPiBridgeSource).not.toContain('CoworkRuntime');
  });

  test('does not couple CoworkView initialization to a separate gateway state', () => {
    expect(coworkViewSource).not.toContain('getOpenClawEngineStatus');
    expect(coworkViewSource).not.toContain('onOpenClawEngineStatus');
    expect(coworkViewSource).not.toContain('engineStatusBanner');

    const initStart = coworkServiceSource.indexOf('async init(): Promise<void>');
    const streamSetupStart = coworkServiceSource.indexOf('private setupStreamListeners');
    const initSource = coworkServiceSource.slice(initStart, streamSetupStart);
    expect(initSource).not.toContain('loadOpenClawEngineStatus');
    expect(initSource).not.toContain('setupOpenClawEngineListeners');
  });
});
