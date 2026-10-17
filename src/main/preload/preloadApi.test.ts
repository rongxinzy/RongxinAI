import { afterEach, describe, expect, test, vi } from 'vitest';

// The vitest config aliases `electron` to tests/__mocks__/electron.ts, whose
// ipcRenderer is a real EventEmitter — listener wiring can be asserted directly.
import { contextBridge, ipcRenderer } from 'electron';

import { AgentIpcChannel } from '../../shared/agent/constants';
import { CoworkSessionIpc, ModelPoolIpc, StoreIpc } from '../../shared/ipc/channels';
import { LlamaCppIpcChannel } from '../../shared/llamacpp/constants';
import { appSystemApi } from './appSystem';
import { automationApi } from './automation';
import { codingAgentApi } from './codingAgent';
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

  test('llamacpp onPullProgress maps install progress payloads', () => {
    const events: Array<{ name: string; chunk: Record<string, unknown> }> = [];
    const off = localInferenceApi.llamacpp.onPullProgress(event => events.push(event));
    const emitProgress = (payload: unknown) =>
      ipcRenderer.emit(LlamaCppIpcChannel.InstallProgress, { sender: {} }, payload);

    emitProgress({
      modelId: 'qwen3',
      phase: 'downloading',
      percent: 41,
    });
    expect(events).toEqual([
      {
        name: 'qwen3',
        chunk: { modelId: 'qwen3', phase: 'downloading', percent: 41, status: 'downloading' },
      },
    ]);

    emitProgress({
      modelName: 'llama3',
      phase: 'verifying',
    });
    expect(events[1]).toEqual({
      name: 'llama3',
      chunk: { modelName: 'llama3', phase: 'verifying', status: 'verifying' },
    });

    emitProgress({});
    expect(events[2]).toEqual({ name: '', chunk: { status: undefined } });

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
  });

  test('modelPool listeners use per-request derived channels', () => {
    const on = vi.spyOn(ipcRenderer, 'on');
    providersApi.modelPool.onStreamData('req-9', () => {});
    expect(on).toHaveBeenCalledWith(ModelPoolIpc.streamData('req-9'), expect.any(Function));
  });

  test('fragment surfaces keep their top-level sections', () => {
    expect(Object.keys(skillsAndMcpApi).sort()).toEqual(['marketplace', 'mcp', 'skills']);
    expect(Object.keys(codingAgentApi)).toEqual(['codingAgent']);
    expect(Object.keys(imApi).sort()).toEqual(['dingtalk', 'feishu', 'im']);
    expect(Object.keys(memoryApi)).toEqual(['memory']);
    expect(Object.keys(automationApi).sort()).toEqual(['activity', 'scheduledTasks']);
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
      'api',
      'appEvents',
      'appInfo',
      'appUpdate',
      'arch',
      'auth',
      'autoLaunch',
      'checkApiConfig',
      'codingAgent',
      'contextMenu',
      'cowork',
      'devNetwork',
      'dialog',
      'dingtalk',
      'enterprise',
      'feishu',
      'generateSessionTitle',
      'getRecentCwds',
      'githubCopilot',
      'hardware',
      'im',
      'llamacpp',
      'log',
      'magpie',
      'managedProviders',
      'marketplace',
      'mcp',
      'memory',
      'modelPool',
      'networkStatus',
      'ollama',
      'openaiCodexOAuth',
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
      'triage',
      'window',
      'workbenchTask',
    ]);
    expect(api.platform).toBe(process.platform);
    expect(api.arch).toBe(process.arch);
  });
});
