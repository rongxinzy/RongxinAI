import { afterEach, describe, expect, test, vi } from 'vitest';

// The vitest config aliases `electron` to tests/__mocks__/electron.ts, whose
// ipcRenderer is a real EventEmitter — listener wiring can be asserted directly.
import { contextBridge, ipcRenderer } from 'electron';

import { AgentIpcChannel } from '../../shared/agent/constants';
import { ContextMenuAction } from '../../shared/contextMenu';
import {
  CompanionIpc,
  ContextMenuIpc,
  CoworkSessionIpc,
  DingTalkInstallIpc,
  LogIpc,
  NetworkIpc,
  StoreIpc,
  WindowIpc,
} from '../../shared/ipc/channels';
import { LlamaCppIpcChannel } from '../../shared/llamacpp/constants';
import { appSystemApi } from './appSystem';
import { artifactsApi } from './artifacts';
import { automationApi } from './automation';
import { codingAgentApi } from './codingAgent';
import { companionApi, companionNavigationApi } from './companion';
import { coworkApi } from './cowork';
import { imApi } from './im';
import { localInferenceApi } from './localInference';
import { memoryApi } from './memory';
import { providersApi } from './providers';
import { onPush, onPushVoid } from './pushChannel';
import { skillsAndMcpApi } from './skillsAndMcp';

afterEach(() => {
  vi.restoreAllMocks();
  ipcRenderer.removeAllListeners();
});

describe('pushChannel helpers', () => {
  test('onPush forwards the payload and unsubscribe stops delivery', () => {
    const seen: string[] = [];
    const off = onPush<string>('test:push', data => seen.push(data));

    ipcRenderer.emit('test:push', { sender: {} }, 'first');
    expect(seen).toEqual(['first']);

    off();
    ipcRenderer.emit('test:push', { sender: {} }, 'second');
    expect(seen).toEqual(['first']);
    expect(ipcRenderer.listenerCount('test:push')).toBe(0);
  });

  test('onPushVoid ignores the ipc event payload', () => {
    let calls = 0;
    const off = onPushVoid('test:void', () => {
      calls += 1;
    });

    ipcRenderer.emit('test:void', { sender: {} }, { ignored: true });
    expect(calls).toBe(1);

    off();
    ipcRenderer.emit('test:void', { sender: {} });
    expect(calls).toBe(1);
    expect(ipcRenderer.listenerCount('test:void')).toBe(0);
  });
});

describe('split api fragments', () => {
  test('app renderer events retain fire-and-forget preload methods and channels', () => {
    const send = vi.spyOn(ipcRenderer, 'send');
    const invoke = vi.spyOn(ipcRenderer, 'invoke');
    const position = { x: 15, y: 20 };

    expect(appSystemApi.window.minimize()).toBeUndefined();
    expect(appSystemApi.window.toggleMaximize()).toBeUndefined();
    expect(appSystemApi.window.close()).toBeUndefined();
    expect(appSystemApi.window.showSystemMenu(position)).toBeUndefined();
    expect(appSystemApi.contextMenu.execute(ContextMenuAction.Copy)).toBeUndefined();
    expect(appSystemApi.networkStatus.send('offline')).toBeUndefined();
    expect(appSystemApi.log.fromRenderer('warn', 'App', 'notice')).toBeUndefined();

    expect(send.mock.calls).toEqual([
      [WindowIpc.Minimize],
      [WindowIpc.ToggleMaximize],
      [WindowIpc.Close],
      [WindowIpc.ShowSystemMenu, position],
      [ContextMenuIpc.Execute, ContextMenuAction.Copy],
      [NetworkIpc.StatusChange, 'offline'],
      [LogIpc.FromRenderer, 'warn', 'App', 'notice'],
    ]);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('companion focus is a payload-free subscription with full cleanup', () => {
    const listener = vi.fn();
    const off = companionApi.companion.onFocus(listener);
    ipcRenderer.emit(CompanionIpc.Focus, { sender: {} });
    expect(listener).toHaveBeenCalledExactlyOnceWith();
    off();
    ipcRenderer.emit(CompanionIpc.Focus, { sender: {} });
    expect(listener).toHaveBeenCalledOnce();
    expect(ipcRenderer.listenerCount(CompanionIpc.Focus)).toBe(0);
  });
  test('companion visibility reads only the dedicated window state channel', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValueOnce(false);
    await expect(companionApi.companion.visibility()).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(CompanionIpc.GetVisibility);
  });
  test('the main window companion bridge exposes only the workbench notification', () => {
    expect(Object.keys(companionNavigationApi.companion)).toEqual(['onWorkbench']);
    const listener = vi.fn();
    const off = companionNavigationApi.companion.onWorkbench(listener);
    ipcRenderer.emit(CompanionIpc.Changed, { sender: {} });
    ipcRenderer.emit(CompanionIpc.Workbench, { sender: {} });
    off();
    ipcRenderer.emit(CompanionIpc.Workbench, { sender: {} });
    expect(listener).toHaveBeenCalledExactlyOnceWith();
  });
  test('appSystem store forwards to StoreIpc channels', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke');
    await appSystemApi.store.get('theme');
    expect(invoke).toHaveBeenCalledWith(StoreIpc.Get, 'theme');
  });

  test('cowork startSession forwards options to CoworkSessionIpc.Start', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke');
    const options = { prompt: 'build it', cwd: '/tmp/w' };
    await coworkApi.cowork.startSession(options);
    expect(invoke).toHaveBeenCalledWith(CoworkSessionIpc.Start, options);
  });

  test('llamacpp forwards typed install progress and removes the subscription', () => {
    const callback = vi.fn();
    const off = localInferenceApi.llamacpp.onInstallProgress(callback);
    const progress = { modelId: 'qwen3', phase: 'downloading', percent: 41 };

    ipcRenderer.emit(LlamaCppIpcChannel.InstallProgress, { sender: {} }, progress);
    expect(callback).toHaveBeenCalledExactlyOnceWith(progress);

    off();
    expect(ipcRenderer.listenerCount(LlamaCppIpcChannel.InstallProgress)).toBe(0);
  });

  test('agents api unwraps the success envelope', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke');

    invoke.mockResolvedValueOnce({ success: true, agents: [{ id: 'a1' }] });
    await expect(providersApi.agents.list()).resolves.toEqual([{ id: 'a1' }]);

    invoke.mockResolvedValueOnce({ success: false });
    await expect(providersApi.agents.list()).resolves.toEqual([]);

    invoke.mockResolvedValueOnce(undefined);
    await expect(providersApi.agents.get('missing')).resolves.toBeNull();

    expect(invoke).toHaveBeenNthCalledWith(1, AgentIpcChannel.List);
    expect(invoke).toHaveBeenNthCalledWith(3, AgentIpcChannel.Get, 'missing');

    invoke.mockResolvedValueOnce({
      success: true,
      deleted: true,
      deletedSessionIds: ['session-1'],
    });
    await expect(providersApi.agents.delete('a1')).resolves.toEqual({
      success: true,
      deleted: true,
      deletedSessionIds: ['session-1'],
    });
    expect(invoke).toHaveBeenNthCalledWith(4, AgentIpcChannel.Delete, 'a1');
  });

  test('fragment surfaces keep their top-level sections', () => {
    expect(Object.keys(skillsAndMcpApi).sort()).toEqual(['marketplace', 'mcp', 'skills']);
    expect(Object.keys(codingAgentApi)).toEqual(['codingAgent']);
    expect(Object.keys(imApi)).toEqual(['im']);
    expect(Object.keys(memoryApi)).toEqual(['memory']);
    expect(Object.keys(artifactsApi)).toEqual(['artifacts']);
    expect(Object.keys(automationApi).sort()).toEqual(['activity', 'scheduledTasks']);
  });

  test('DingTalk setup forwards the shared IM contract arguments', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke');
    await imApi.im.dingtalkLoginStart();
    await imApi.im.dingtalkLoginPoll({ deviceCode: 'device' });
    expect(invoke).toHaveBeenNthCalledWith(1, DingTalkInstallIpc.Qrcode);
    expect(invoke).toHaveBeenNthCalledWith(2, DingTalkInstallIpc.Poll, { deviceCode: 'device' });
  });
});

describe('preload entry', () => {
  test('exposes the full window.electron api surface', async () => {
    const spy = vi.spyOn(contextBridge, 'exposeInMainWorld');
    await import('../preload');

    expect(spy).toHaveBeenCalledTimes(1);
    const [key, api] = spy.mock.calls[0];
    expect(key).toBe('electron');
    expect(Object.keys(api).sort()).toEqual([
      'activity',
      'agents',
      'appEvents',
      'appInfo',
      'appUpdate',
      'arch',
      'artifacts',
      'auth',
      'autoLaunch',
      'checkApiConfig',
      'codingAgent',
      'companion',
      'contextMenu',
      'cowork',
      'desktopPet',
      'dialog',
      'enterprise',
      'generateSessionTitle',
      'getRecentCwds',
      'hardware',
      'im',
      'llamacpp',
      'log',
      'magpie',
      'managedProviders',
      'marketplace',
      'mcp',
      'memory',
      'networkStatus',
      'permissions',
      'platform',
      'preventSleep',
      'project',
      'runtimeNotices',
      'scheduledTasks',
      'shell',
      'skills',
      'store',
      'todo',
      'window',
      'workbenchTask',
    ]);
    expect(api.platform).toBe(process.platform);
    expect(api.arch).toBe(process.arch);
  });
});
