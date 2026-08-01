import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const mainSource = readSource('../../main.ts');
const coworkViewSource = readSource('../../../renderer/components/cowork/CoworkView.tsx');
const coworkServiceSource = readSource('../../../renderer/services/cowork.ts');
const piRuntimeAdapterSource = readSource('./piRuntimeAdapter.ts');

describe('Work/Chat runtime isolation', () => {
  test('Pi workbench runtime does not implement the OpenClaw CoworkRuntime glue', () => {
    expect(piRuntimeAdapterSource).not.toContain("from './types'");
    expect(piRuntimeAdapterSource).not.toContain('CoworkRuntime');
    expect(piRuntimeAdapterSource).toContain('implements PiRuntime');
  });

  test('projects only Pi runtime events into cowork streams', () => {
    expect(mainSource).toContain('forwardPiWorkbenchRuntimeToRenderer(getPiRuntimeAdapter())');
    expect(mainSource).not.toContain(
      'forwardPiWorkbenchRuntimeToRenderer(getOpenClawRuntimeAdapter())',
    );
    expect(mainSource).toContain('getOpenClawRuntimeAdapter();');
    expect(mainSource).not.toContain("webContents.send('cowork:stream:");
  });

  test('keeps OpenClaw AskUser traffic on its dedicated bridge', () => {
    expect(mainSource).toContain('win.webContents.send(OpenClawBridgeIpc.AskUser');
    expect(mainSource).toContain('OpenClawBridgeIpc.AskUserDismiss');
    expect(mainSource).toContain('registerOpenClawBridgeIpcHandlers');
  });

  test('does not couple CoworkView initialization to OpenClaw Gateway state', () => {
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
