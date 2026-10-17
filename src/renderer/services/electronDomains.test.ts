// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { electronDomains } from './electronDomains';

describe('electronDomains', () => {
  const fakeElectron = {
    platform: 'darwin',
    arch: 'arm64',
    hardware: { getInfo: () => Promise.resolve({}) },
    window: { minimize: () => {}, maximize: () => {}, close: () => {} },
    shell: { openExternal: () => Promise.resolve() },
    dialog: { showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [] }) },
    log: { info: () => {}, error: () => {} },
    autoLaunch: {
      get: () => Promise.resolve({ enabled: false }),
      set: () => Promise.resolve({ success: true }),
    },
    preventSleep: {
      get: () => Promise.resolve({ enabled: false }),
      set: () => Promise.resolve({ success: true }),
    },
    networkStatus: { send: () => {} },
    appInfo: { getVersion: () => Promise.resolve('1.0.0') },
    appUpdate: { checkForUpdates: () => Promise.resolve() },
    contextMenu: { show: () => {} },
    appEvents: { on: () => () => {} },
    runtimeNotices: { onNotice: () => () => {} },
    llamacpp: { status: () => Promise.resolve('stopped') },
    ollama: { list: () => Promise.resolve([]) },
    magpie: { list: () => Promise.resolve([]) },
    modelPool: { list: () => Promise.resolve([]) },
    managedProviders: { list: () => Promise.resolve([]) },
    triage: { run: () => Promise.resolve({}) },
    marketplace: { list: () => Promise.resolve([]) },
    cowork: { startSession: () => Promise.resolve('sess-1') },
    agents: { list: () => Promise.resolve([]) },
    skills: { list: () => Promise.resolve([]) },
    mcp: { list: () => Promise.resolve([]) },
    todo: { list: () => Promise.resolve([]) },
    codingAgent: { start: () => Promise.resolve() },
    workbenchTask: { list: () => Promise.resolve([]) },
    project: { list: () => Promise.resolve([]) },
    memory: { list: () => Promise.resolve({ items: [] }) },
    store: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
    getRecentCwds: () => Promise.resolve([]),
    im: { list: () => Promise.resolve([]) },
    scheduledTasks: { list: () => Promise.resolve([]) },
    auth: { getToken: () => Promise.resolve(null) },
    permissions: { request: () => Promise.resolve(true) },
    feishu: { auth: () => Promise.resolve() },
    dingtalk: { auth: () => Promise.resolve() },
    githubCopilot: { auth: () => Promise.resolve() },
    openaiCodexOAuth: { auth: () => Promise.resolve() },
    activity: { list: () => Promise.resolve([]) },
    enterprise: { getStatus: () => Promise.resolve({}) },
  };

  beforeEach(() => {
    // @ts-expect-error test mock
    window.electron = fakeElectron;
  });

  it('correctly maps domains from window.electron', () => {
    expect(electronDomains.system).toBeDefined();
    expect(electronDomains.inference).toBeDefined();
    expect(electronDomains.agent).toBeDefined();
    expect(electronDomains.workspace).toBeDefined();
    expect(electronDomains.integration).toBeDefined();
  });

  it('provides scoped access to domain modules matching window.electron', () => {
    expect(electronDomains.system.platform).toBe(fakeElectron.platform);
    expect(electronDomains.system.arch).toBe(fakeElectron.arch);
    expect(electronDomains.agent.cowork).toBe(fakeElectron.cowork);
    expect(electronDomains.agent.skills).toBe(fakeElectron.skills);
    expect(electronDomains.agent.mcp).toBe(fakeElectron.mcp);
    expect(electronDomains.workspace.memory).toBe(fakeElectron.memory);
    expect(electronDomains.workspace.store).toBe(fakeElectron.store);
    expect(electronDomains.inference.llamacpp).toBe(fakeElectron.llamacpp);
    expect(electronDomains.integration.im).toBe(fakeElectron.im);
  });
});
