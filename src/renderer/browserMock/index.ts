// @ts-nocheck - Mock implementation intentionally ignores parameters
/**
 * Browser mock implementation of window.electron API.
 * Provides realistic fixture data for all renderer screens.
 * Only used in browser preview mode (Vite dev without Electron).
 */

import type { CoworkRunSnapshot, CoworkContentPatch } from '@shared/cowork/runState';
import {
  mockCoworkSessions,
  mockCoworkMessages,
  mockRunSnapshot,
  mockCoworkConfig,
  mockWorkspaces,
} from './fixtures/coworkFixtures';
import {
  mockSkills,
  mockSkillsRoot,
  mockSkillContent,
  mockMarketplaceSkills,
} from './fixtures/skillsFixtures';
import { mockMcpServers, mockMarketplaceMcp } from './fixtures/mcpFixtures';
import {
  mockLlamaCppStatus,
  mockLlamaCppModels,
  mockRunningModels,
  mockOllamaStatus,
  mockModelPreferences,
} from './fixtures/localInferenceFixtures';
import {
  mockScheduledTasks,
  mockScheduledTaskRuns,
  mockChannels,
} from './fixtures/scheduledTasksFixtures';
import {
  mockAppInfo,
  mockApiConfig,
  mockRecentCwds,
  mockAgents,
  mockMemoryLinks,
  mockTodos,
  mockTodoLists,
} from './fixtures/appFixtures';

type Callback = (...args: any[]) => void;
const mockListeners = new Map<string, Set<Callback>>();

function onPush<T>(channel: string, callback: (data: T) => void): () => void {
  if (!mockListeners.has(channel)) {
    mockListeners.set(channel, new Set());
  }
  mockListeners.get(channel)!.add(callback);
  return () => {
    mockListeners.get(channel)?.delete(callback);
  };
}

function onPushVoid(channel: string, callback: () => void): () => void {
  return onPush(channel, callback);
}

const success = <T>(data: T) => Promise.resolve({ success: true, ...data });
const mockPromise = <T>(data: T) => Promise.resolve(data);

export const browserMockElectron = {
  platform: mockAppInfo.platform,
  arch: mockAppInfo.arch,

  store: {
    get: (key: string) => mockPromise(null),
    set: (key: string, value: unknown) => mockPromise(undefined),
    remove: (key: string) => mockPromise(undefined),
  },

  skills: {
    list: () => mockPromise(mockSkills),
    setEnabled: (options: { id: string; enabled: boolean }) => mockPromise(undefined),
    setEnabledBatch: (options: { ids: string[]; enabled: boolean }) => mockPromise(undefined),
    setPinned: (options: { id: string; pinned: boolean }) => mockPromise(undefined),
    delete: (id: string) => mockPromise(undefined),
    download: (source: string, options?: { iconUrl?: string; displayName?: string }) =>
      mockPromise({ success: true, id: 'new-skill' }),
    confirmInstall: (pendingId: string, action: string) => mockPromise(undefined),
    getRoot: () => mockPromise(mockSkillsRoot),
    getContent: (skillId: string) => mockPromise(mockSkillContent),
    autoRoutingPrompt: () => mockPromise('Use appropriate skills for the task'),
    getConfig: (skillId: string) => mockPromise({}),
    setConfig: (skillId: string, config: Record<string, string>) => mockPromise(undefined),
    testEmailConnectivity: (skillId: string, config: Record<string, string>) =>
      mockPromise({ success: true }),
    fetchMarketplace: (options?: { pageNumber?: number; pageSize?: number }) =>
      mockPromise({ skills: mockMarketplaceSkills, total: mockMarketplaceSkills.length }),
    fetchMarketplaceContent: (skillId: string) => mockPromise(mockSkillContent),
    onChanged: (callback: () => void) => onPushVoid('skills:changed', callback),
  },

  mcp: {
    list: () => mockPromise(mockMcpServers),
    create: (data: unknown) => mockPromise({ success: true, id: 'new-mcp' }),
    update: (id: string, data: unknown) => mockPromise({ success: true }),
    delete: (id: string) => mockPromise({ success: true }),
    setEnabled: (options: { id: string; enabled: boolean }) => mockPromise(undefined),
    testConnection: (data: unknown) => mockPromise({ success: true, tools: [] }),
    fetchMarketplace: () => mockPromise(mockMarketplaceMcp),
    refreshBridge: () => mockPromise(undefined),
    authorize: (data: unknown) => mockPromise({ success: true }),
    cancelAuthorize: (requestId: string) => mockPromise(undefined),
    getFeishuCliStatus: () => mockPromise({ installed: false }),
    prepareFeishuCli: () => mockPromise({ success: true }),
    loadIcon: (iconPath: string) => mockPromise(null),
    exportConfig: () => mockPromise({ success: true }),
    importConfig: () => mockPromise({ success: true }),
    onBridgeSyncStart: (callback: () => void) => onPushVoid('mcp:bridge:syncStart', callback),
    onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) =>
      onPush('mcp:bridge:syncDone', callback),
  },

  ollama: {
    status: () => mockPromise(mockOllamaStatus),
    install: () => mockPromise({ success: true }),
    start: () => mockPromise({ success: true }),
    stop: () => mockPromise({ success: true }),
    restart: () => mockPromise({ success: true }),
    getServiceConfig: () => mockPromise({}),
    setServiceConfig: (config: unknown) => mockPromise(undefined),
    modelsDir: () => mockPromise('/home/user/.ollama/models'),
    listLocalModels: () => mockPromise([]),
    listRunningModels: () => mockPromise([]),
    deleteModel: (name: string) => mockPromise({ success: true }),
    showModel: (name: string) => mockPromise({ name, size: 0 }),
    createModel: (name: string, modelfile: string) => mockPromise({ success: true }),
    preloadModel: (input: unknown) => mockPromise({ success: true }),
    unloadModel: (name: string) => mockPromise({ success: true }),
    pullModel: (name: string) => mockPromise({ success: true }),
    cancelPull: (name: string) => mockPromise(undefined),
    chat: (payload: unknown) => mockPromise({ message: { content: 'Mock response' } }),
    chatStream: (requestId: string, payload: unknown) => mockPromise(undefined),
    cancelChatStream: (requestId: string) => mockPromise(undefined),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush('ollama:statusChanged', callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush('ollama:installProgress', callback),
    onPullProgress: (callback: (payload: unknown) => void) =>
      onPush('ollama:pullProgress', callback),
    onChatStreamChunk: (callback: (payload: unknown) => void) =>
      onPush('ollama:chatStreamChunk', callback),
  },

  llamacpp: {
    status: () => mockPromise(mockLlamaCppStatus),
    install: () => mockPromise({ success: true }),
    cancelRuntimeInstall: () => mockPromise(undefined),
    uninstallRuntime: () => mockPromise({ success: true }),
    listRuntimeDevices: (input?: unknown) => mockPromise([]),
    listBackends: () => mockPromise(['cpu', 'metal', 'cuda']),
    getBackendDownloadSize: (input: unknown) => mockPromise({ size: 1073741824 }),
    getBackendSelection: () => mockPromise({ backend: 'cpu' }),
    setBackendSelection: (input: unknown) => mockPromise(undefined),
    installBackend: (input?: unknown) => mockPromise({ success: true }),
    getRuntimeInstallSnapshot: () => mockPromise({ status: 'idle' }),
    uninstallBackend: (input?: unknown) => mockPromise({ success: true }),
    getRuntimeCapabilities: () => mockPromise(mockLlamaCppStatus.capabilities),
    importRuntime: () => mockPromise({ success: true }),
    start: () => mockPromise({ success: true }),
    stop: () => mockPromise({ success: true }),
    restart: () => mockPromise({ success: true }),
    getServiceConfig: () => mockPromise({}),
    setServiceConfig: (config: unknown) => mockPromise(undefined),
    getGatewayLanToken: () => mockPromise(mockLlamaCppStatus.gatewayLanToken),
    regenerateGatewayLanToken: () => mockPromise('new-mock-token'),
    modelsDir: () => mockPromise(mockLlamaCppStatus.modelsDir),
    setModelsDir: (modelsDir: string) => mockPromise(undefined),
    listLocalModels: () => mockPromise(mockLlamaCppModels),
    listRunningModels: () => mockPromise(mockRunningModels),
    refreshRunningModelBindings: () => mockPromise(undefined),
    importModelFiles: (paths: string[]) => mockPromise({ success: true }),
    deleteModel: (name: string) => mockPromise({ success: true }),
    showModel: (name: string) => mockPromise(mockLlamaCppModels[0]),
    getModelPreferences: () => mockPromise(mockModelPreferences),
    setModelPreference: (input: unknown) => mockPromise(undefined),
    loadModel: (input: unknown) => mockPromise({ success: true }),
    cancelModelLoad: (modelName?: string) => mockPromise(undefined),
    unloadModel: (name: string) => mockPromise({ success: true }),
    getLatestModelLaunchLogSession: (input?: unknown) => mockPromise(null),
    readModelLaunchLogFile: (input: unknown) => mockPromise(''),
    openModelLaunchLogWindow: (input?: unknown) => mockPromise(undefined),
    installModel: (input: unknown) => mockPromise({ success: true }),
    cancelInstall: (modelId: string) => mockPromise(undefined),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush('llamacpp:statusChanged', callback),
    onModelBindingsChanged: (callback: () => void) =>
      onPushVoid('llamacpp:modelBindingsChanged', callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush('llamacpp:installProgress', callback),
    onModelLaunchLog: (callback: (event: unknown) => void) =>
      onPush('llamacpp:modelLaunchLog', callback),
    onModelLaunchLogCleared: (callback: (event: unknown) => void) =>
      onPush('llamacpp:modelLaunchLogCleared', callback),
    onModelLaunchLogWindowTargetChanged: (callback: (target: unknown) => void) =>
      onPush('llamacpp:modelLaunchLogWindowTargetChanged', callback),
    onPullProgress: (
      callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
    ) => onPush('llamacpp:pullProgress', callback),
  },

  marketplace: {
    search: (request: any) => mockPromise({ results: [], total: 0 }),
    cancelSearch: (requestId: string) => mockPromise(undefined),
  },

  triage: {
    getConfig: () => mockPromise({}),
    setConfig: (config: unknown) => mockPromise(undefined),
  },

  hardware: {
    nvidiaSmi: () => mockPromise(null),
    systemMemory: () => mockPromise({ total: 16000000000, available: 8000000000 }),
  },

  permissions: {
    checkCalendar: () => mockPromise({ authorized: false }),
    requestCalendar: () => mockPromise({ authorized: false }),
  },

  enterprise: {
    getConfig: () => mockPromise(null),
    renderer: {
      sessionGateEntrypoint: () => mockPromise(null),
      settingsPages: () => mockPromise([]),
    },
    session: {
      snapshot: () => mockPromise(null),
      login: (input: unknown) => mockPromise({ success: false }),
      changePassword: (input: unknown) => mockPromise({ success: false }),
      logout: () => mockPromise(undefined),
    },
  },

  managedProviders: {
    policy: () => mockPromise({ allowCustomProviders: true, allowedProviders: [] }),
    catalog: () => mockPromise([]),
    onChanged: (callback: () => void) => onPushVoid('managedProvider:changed', callback),
    aisphereSnapshot: () => mockPromise({ connected: false, address: null, models: [] }),
    aisphereConnect: (address: string) =>
      mockPromise({ connected: false, address: null, models: [] }),
    aisphereRefresh: () => mockPromise({ connected: false, address: null, models: [] }),
  },

  api: {
    fetch: (options: any) => mockPromise({ ok: true, status: 200, body: '{}' }),
    fetchModels: (input: any) => mockPromise({ models: [] }),
  },

  appEvents: {
    onOpenSettings: (callback: () => void) => onPushVoid('app:openSettings', callback),
    onNewTask: (callback: () => void) => onPushVoid('app:newTask', callback),
  },

  contextMenu: {
    execute: (action: any) => {},
    onOpen: (callback: (event: any) => void) => onPush('context-menu:open', callback),
  },

  window: {
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    isMaximized: () => mockPromise(false),
    showSystemMenu: (position: { x: number; y: number }) => {},
    toggleDevTools: () => mockPromise(undefined),
    openDevTools: () => mockPromise(undefined),
    onStateChanged: (callback: (state: any) => void) => onPush('window:state-changed', callback),
  },

  getApiConfig: () => mockPromise(mockApiConfig),
  checkApiConfig: (options?: { probeModel?: boolean }) =>
    mockPromise({ valid: true, model: 'gpt-4' }),
  saveApiConfig: (config: any) => mockPromise(undefined),
  generateSessionTitle: (userInput: string | null) =>
    mockPromise('New session ' + new Date().toLocaleString()),
  getRecentCwds: (limit?: number) => mockPromise(mockRecentCwds),

  agents: {
    list: () => success({ agents: mockAgents }),
    get: (id: string) => success({ agent: mockAgents[0] }),
    create: (request: any) => success({ agent: { ...request, id: 'new-agent' } }),
    update: (id: string, updates: any) => success({ agent: { ...mockAgents[0], ...updates } }),
    delete: (id: string) => success({ deleted: true }),
    importExpertPackage: (expertDir: string) => mockPromise({ success: true }),
    getPresetExperts: () => mockPromise([]),
  },

  cowork: {
    getRunSnapshot: (sessionId: string, replayContent = false) => mockPromise(mockRunSnapshot),
    onStreamRunState: (callback: (snapshot: CoworkRunSnapshot) => void) =>
      onPush('cowork:stream:runState', callback),
    onStreamContentPatch: (callback: (patch: CoworkContentPatch) => void) =>
      onPush('cowork:stream:contentPatch', callback),
    listWorkspaces: () => mockPromise(mockWorkspaces),
    createWorkspace: (options: { path: string; name: string }) =>
      mockPromise({ id: 'new-workspace', ...options }),
    ensureWorkspace: (options: { path: string; name?: string }) =>
      mockPromise({ id: 'workspace-1', name: options.name || 'Project' }),
    renameWorkspace: (id: string, name: string) => mockPromise(undefined),
    updateWorkspace: (options: any) => mockPromise(undefined),
    deleteWorkspace: (id: string) => mockPromise(undefined),
    startSession: (options: any) =>
      mockPromise({ sessionId: 'new-session', mode: options.mode || 'work' }),
    continueSession: (options: any) => mockPromise(undefined),
    listPendingMessages: (sessionId: string) => mockPromise([]),
    enqueuePendingMessage: (options: any) => mockPromise({ itemId: 'pending-msg' }),
    updatePendingMessage: (options: any) => mockPromise(undefined),
    deletePendingMessage: (options: any) => mockPromise(undefined),
    steerPendingMessage: (options: any) => mockPromise(undefined),
    followUpPendingMessage: (options: any) => mockPromise(undefined),
    stopSession: (sessionId: string) => mockPromise(undefined),
    compactSession: (sessionId: string) => mockPromise(undefined),
    saveSession: (session: Record<string, unknown>) => mockPromise(undefined),
    deleteSession: (sessionId: string) => mockPromise(undefined),
    deleteSessions: (sessionIds: string[]) => mockPromise(undefined),
    setSessionPinned: (options: { sessionId: string; pinned: boolean }) => mockPromise(undefined),
    renameSession: (options: { sessionId: string; title: string }) => mockPromise(undefined),
    updateSessionModel: (options: { sessionId: string; modelOverride: string }) =>
      mockPromise(undefined),
    getSession: (sessionId: string, options?: any) => mockPromise(mockCoworkSessions[0]),
    getRuntimeSnapshots: (sessionId?: string) => mockPromise([]),
    remoteManaged: (sessionId: string) => mockPromise(false),
    listSessions: (options?: any) => mockPromise(mockCoworkSessions),
    getSessionMessages: (options: any) => mockPromise(mockCoworkMessages),
    exportResultImage: (options: any) => mockPromise({ success: true }),
    captureImageChunk: (options: any) => mockPromise({ base64: '' }),
    saveResultImage: (options: any) => mockPromise({ success: true }),
    exportSessionText: (options: any) => mockPromise({ success: true }),
    respondToPermission: (options: { requestId: string; result: unknown }) =>
      mockPromise(undefined),
    getConfig: () => mockPromise(mockCoworkConfig),
    setConfig: (config: any) => mockPromise(undefined),
    onStreamUiEvent: (callback: (event: any) => void) => onPush('cowork:stream:uiEvent', callback),
    onSessionsChanged: (callback: (data: any) => void) =>
      onPush('cowork:sessions:changed', callback),
  },

  workbenchTask: {
    getCurrent: (sessionId: string) => mockPromise(null),
    getDetail: (taskId: string) => mockPromise(null),
    listForSession: (sessionId: string) => mockPromise([]),
    exportAudit: (taskId: string) => mockPromise({ success: true }),
    resume: (input: any) => mockPromise({ success: true }),
    retry: (taskId: string) => mockPromise({ success: true }),
    accept: (taskId: string) => mockPromise({ success: true }),
    respondToApproval: (input: any) => mockPromise(undefined),
    onChanged: (callback: (event: any) => void) => onPush('workbenchTask:changed', callback),
  },

  todo: {
    list: (input: any) => mockPromise(mockTodos),
    create: (input: any) => mockPromise({ id: 'new-todo', ...input }),
    update: (input: any) => mockPromise(undefined),
    delete: (todoId: string) => mockPromise(undefined),
    listLists: () => mockPromise(mockTodoLists),
    createList: (input: any) => mockPromise({ id: 'new-list', ...input }),
    updateList: (input: any) => mockPromise(undefined),
    deleteList: (listId: string) => mockPromise(undefined),
    createStep: (input: any) => mockPromise({ id: 'new-step', ...input }),
    updateStep: (input: any) => mockPromise(undefined),
    deleteStep: (stepId: string) => mockPromise(undefined),
    onChanged: (callback: (event: any) => void) => onPush('todo:changed', callback),
  },

  codingAgent: {
    listProfiles: () => mockPromise([]),
    listWorkspaces: () => mockPromise([]),
    createWorkspace: (input: any) => mockPromise({ workspaceId: 'new-workspace' }),
    updateWorkspace: (input: any) => mockPromise(undefined),
    deleteWorkspace: (workspaceId: string) => mockPromise(undefined),
    deleteSession: (input: any) => mockPromise(undefined),
    getProfileConfigOptions: (profileId: string) => mockPromise([]),
    getProfileAvailableCommands: (profileId: string) => mockPromise([]),
    createSession: (input: any) => mockPromise({ laneId: 'new-lane' }),
    startSession: (input: any) => mockPromise(undefined),
    bootstrap: (workspaceRoot: string) => mockPromise({ snapshot: {} }),
    loadEventPage: (input: any) => mockPromise({ events: [] }),
    prepareLane: (input: any) => mockPromise(undefined),
    createMission: (input: any) => mockPromise({ missionId: 'new-mission' }),
    selectLane: (input: any) => mockPromise(undefined),
    prompt: (input: any) => mockPromise(undefined),
    listPendingMessages: (laneId: string) => mockPromise([]),
    enqueuePendingMessage: (input: any) => mockPromise({ itemId: 'pending-msg' }),
    updatePendingMessage: (input: any) => mockPromise(undefined),
    deletePendingMessage: (input: any) => mockPromise(undefined),
    steerPendingMessage: (input: any) => mockPromise(undefined),
    followUpPendingMessage: (input: any) => mockPromise(undefined),
    confirmSessionRecovery: (input: any) => mockPromise(undefined),
    cancel: (input: any) => mockPromise(undefined),
    respondElicitation: (input: any) => mockPromise(undefined),
    cancelElicitation: (input: any) => mockPromise(undefined),
    previewHandoff: (input: any) => mockPromise({ preview: {} }),
    handoff: (input: any) => mockPromise(undefined),
    addLane: (input: any) => mockPromise({ laneId: 'new-lane' }),
    createCollaborationPreset: (input: any) => mockPromise({ presetId: 'new-preset' }),
    saveLaneView: (input: any) => mockPromise(undefined),
    setLaneConfigOption: (input: any) => mockPromise(undefined),
    setLaneModelOverride: (input: any) => mockPromise(undefined),
    previewLaneChanges: (input: any) => mockPromise({ changes: [] }),
    applyLaneChanges: (input: any) => mockPromise({ success: true }),
    getGitStatus: (input: any) => mockPromise({ status: {} }),
    getGitDiff: (input: any) => mockPromise({ diff: '' }),
    stageGitPaths: (input: any) => mockPromise(undefined),
    unstageGitPaths: (input: any) => mockPromise(undefined),
    commitGitChanges: (input: any) => mockPromise({ success: true }),
    commitAndPushGitChanges: (input: any) => mockPromise({ success: true }),
    pushGitBranch: (input: any) => mockPromise({ success: true }),
    switchGitBranch: (input: any) => mockPromise({ success: true }),
    createGitBranch: (input: any) => mockPromise({ success: true }),
    createGitPullRequest: (input: any) => mockPromise({ prUrl: 'https://example.com/pr/1' }),
    listWorkspaceFiles: (input: any) => mockPromise({ files: [] }),
    readWorkspaceFile: (input: any) => mockPromise({ content: '' }),
    writeWorkspaceFile: (input: any) => mockPromise({ success: true }),
    discoverAgents: (input: any) => mockPromise({ agents: [] }),
    probeAgent: (input: any) => mockPromise({ available: false }),
    addProfile: (input: any) => mockPromise({ profileId: 'new-profile' }),
    trustProfile: (input: any) => mockPromise(undefined),
    authenticateProfile: (input: any) => mockPromise({ success: true }),
    startAuthTerminal: (input: any) => mockPromise({ id: 'terminal-1' }),
    writeAuthTerminal: (input: any) => mockPromise(undefined),
    resizeAuthTerminal: (input: any) => mockPromise(undefined),
    cancelAuthTerminal: (id: string) => mockPromise(undefined),
    respondPermission: (input: any) => mockPromise(undefined),
    onChanged: (callback: (snapshot: any) => void) => onPush('codingAgent:changed', callback),
    onEventDelta: (callback: (delta: any) => void) => onPush('codingAgent:eventDelta', callback),
    onPendingMessagesChanged: (callback: (event: any) => void) =>
      onPush('codingAgent:pendingMessagesChanged', callback),
    onAuthTerminalData: (callback: (event: any) => void) =>
      onPush('codingAgent:authTerminalData', callback),
    onAuthTerminalExit: (callback: (event: any) => void) =>
      onPush('codingAgent:authTerminalExit', callback),
  },

  dialog: {
    selectDirectory: (options?: any) => mockPromise({ canceled: true, filePaths: [] }),
    selectFile: (options?: any) => mockPromise({ canceled: true, filePaths: [] }),
    selectFiles: (options?: any) => mockPromise({ canceled: true, filePaths: [] }),
    saveInlineFile: (options: any) => mockPromise({ success: true }),
    readFileAsDataUrl: (filePath: string) => mockPromise('data:text/plain;base64,'),
    checkArtifactFile: (filePath: string) => mockPromise({ exists: false }),
    generateThumbnail: (filePath: string) => mockPromise(null),
    showMessageBox: (options: any) => mockPromise({ response: 0 }),
  },

  project: {
    getDefaultBaseDir: () => mockPromise('/home/user/projects'),
    createDirectory: (options: any) => mockPromise({ path: '/home/user/projects/' + options.name }),
    ensureScratchDir: () => mockPromise('/home/user/.zhiyuan/scratch'),
    createRandomWorkspace: () => mockPromise({ path: '/home/user/.zhiyuan/workspace-temp' }),
  },

  shell: {
    openPath: (filePath: string) => mockPromise(''),
    showItemInFolder: (filePath: string) => mockPromise(undefined),
    openExternal: (url: string) => mockPromise(undefined),
    openHtmlInBrowser: (htmlContent: string) => mockPromise(undefined),
    pathExists: (filePath: string) => mockPromise(false),
  },

  autoLaunch: {
    get: () => mockPromise(false),
    set: (enabled: boolean) => mockPromise(undefined),
  },

  preventSleep: {
    get: () => mockPromise(false),
    set: (enabled: boolean) => mockPromise(undefined),
  },

  appInfo: {
    getVersion: () => mockPromise(mockAppInfo.version),
    isDev: () => mockPromise(mockAppInfo.isDev),
    isEnterprise: () => mockPromise(mockAppInfo.isEnterprise),
    getSystemLocale: () => mockPromise(mockAppInfo.systemLocale),
    consumePendingLocalInferenceInstall: () => mockPromise(null),
    relaunch: () => mockPromise(undefined),
  },

  appUpdate: {
    getState: () => mockPromise({ status: 'idle' }),
    checkNow: (options?: any) => mockPromise({ available: false }),
    retryDownload: () => mockPromise(undefined),
    pauseDownload: () => mockPromise(undefined),
    resumeDownload: () => mockPromise(undefined),
    cancelDownload: () => mockPromise(undefined),
    installReady: () => mockPromise(undefined),
    revealDownload: () => mockPromise(undefined),
    onStateChanged: (callback: (data: unknown) => void) =>
      onPush('appUpdate:stateChanged', callback),
  },

  log: {
    getPath: () => mockPromise('/home/user/.zhiyuan/logs'),
    openFolder: () => mockPromise(undefined),
    exportZip: () => mockPromise({ success: true }),
    fromRenderer: (level: string, tag: string, message: string) => {},
  },

  runtimeNotices: {
    onNotice: (callback: (notice: any) => void) => onPush('runtime:notice', callback),
  },

  im: {
    getConfig: () => mockPromise({}),
    setConfig: (config: unknown, options?: any) => mockPromise(undefined),
    syncConfig: () => mockPromise(undefined),
    startGateway: (platform: any) => mockPromise({ success: true }),
    stopGateway: (platform: any) => mockPromise({ success: true }),
    testGateway: (platform: any, configOverride?: unknown, accountId?: string) =>
      mockPromise({ success: true }),
    getStatus: () => mockPromise({}),
    getLocalIp: () => mockPromise('192.168.1.100'),
    weixinLoginStart: () => mockPromise({ qrcode: 'mock-qrcode' }),
    weixinLoginPoll: (qrcode: string) => mockPromise({ status: 'pending' }),
    addDingTalkInstance: (name: string, workspaceId: string) => mockPromise({ instanceId: 'dt-1' }),
    deleteDingTalkInstance: (instanceId: string) => mockPromise(undefined),
    setDingTalkInstanceConfig: (instanceId: string, config: unknown, options?: any) =>
      mockPromise(undefined),
    addQQInstance: (name: string, workspaceId: string) => mockPromise({ instanceId: 'qq-1' }),
    deleteQQInstance: (instanceId: string) => mockPromise(undefined),
    setQQInstanceConfig: (instanceId: string, config: unknown, options?: any) =>
      mockPromise(undefined),
    addFeishuInstance: (name: string, workspaceId: string) => mockPromise({ instanceId: 'fs-1' }),
    deleteFeishuInstance: (instanceId: string) => mockPromise(undefined),
    setFeishuInstanceConfig: (instanceId: string, config: unknown, options?: any) =>
      mockPromise(undefined),
    addWecomInstance: (name: string, workspaceId: string) => mockPromise({ instanceId: 'wc-1' }),
    deleteWecomInstance: (instanceId: string) => mockPromise(undefined),
    setWecomInstanceConfig: (instanceId: string, config: unknown, options?: any) =>
      mockPromise(undefined),
    addTelegramInstance: (name: string, workspaceId: string) => mockPromise({ instanceId: 'tg-1' }),
    deleteTelegramInstance: (instanceId: string) => mockPromise(undefined),
    setTelegramInstanceConfig: (instanceId: string, config: unknown, options?: any) =>
      mockPromise(undefined),
    addDiscordInstance: (name: string, workspaceId: string) => mockPromise({ instanceId: 'dc-1' }),
    deleteDiscordInstance: (instanceId: string) => mockPromise(undefined),
    setDiscordInstanceConfig: (instanceId: string, config: unknown, options?: any) =>
      mockPromise(undefined),
    onStatusChange: (callback: (status: unknown) => void) => onPush('im:status:change', callback),
    onMessageReceived: (callback: (message: unknown) => void) =>
      onPush('im:message:received', callback),
  },

  memory: {
    list: (input?: unknown) => mockPromise(mockMemoryLinks),
    resolveSessionTitles: (input: unknown) => mockPromise({}),
    createManual: (input: unknown) => mockPromise({ id: 'new-memory' }),
    updateManual: (input: unknown) => mockPromise(undefined),
    confirmCandidate: (id: string) => mockPromise(undefined),
    archive: (id: string) => mockPromise(undefined),
    restore: (id: string) => mockPromise(undefined),
    forget: (id: string, hardDelete: boolean) => mockPromise(undefined),
    drainOutbox: () => mockPromise(undefined),
  },

  scheduledTasks: {
    list: () => mockPromise(mockScheduledTasks),
    get: (id: string) => mockPromise(mockScheduledTasks[0]),
    create: (input: unknown) => mockPromise({ id: 'new-task' }),
    update: (id: string, input: unknown) => mockPromise(undefined),
    delete: (id: string) => mockPromise(undefined),
    toggle: (id: string, enabled: boolean) => mockPromise(undefined),
    runManually: (id: string) => mockPromise({ runId: 'new-run' }),
    stop: (id: string) => mockPromise(undefined),
    preflight: (id: string) => mockPromise({ valid: true }),
    listRuns: (taskId: string, limit?: number, offset?: number, filter?: unknown) =>
      mockPromise(mockScheduledTaskRuns),
    listDeliveries: (runId: string) => mockPromise([]),
    countRuns: (taskId: string) => mockPromise({ count: 2 }),
    listAllRuns: (limit?: number, offset?: number, filter?: unknown) =>
      mockPromise(mockScheduledTaskRuns),
    resolveSession: (sessionKey: string) => mockPromise(null),
    listChannels: () => mockPromise(mockChannels),
    listChannelConversations: (channel: string, accountId?: string, filterAccountId?: string) =>
      mockPromise([]),
    onStatusUpdate: (callback: (data: unknown) => void) =>
      onPush('scheduledTask:statusUpdate', callback),
    onRunUpdate: (callback: (data: unknown) => void) => onPush('scheduledTask:runUpdate', callback),
    onRefresh: (callback: () => void) => onPushVoid('scheduledTask:refresh', callback),
  },

  networkStatus: {
    send: (status: 'online' | 'offline') => {},
  },

  devNetwork: {
    onEntry: (callback: (entry: any) => void) => onPush('dev-network:entry', callback),
  },

  auth: {
    communityLogin: () => mockPromise({ success: false }),
    getCommunityUser: () => mockPromise(null),
    communityLogout: () => mockPromise(undefined),
    onCommunityCallback: (callback: (data: any) => void) =>
      onPush('auth:communityCallback', callback),
  },

  modelPool: {
    listModels: () => mockPromise([]),
    stream: (input: any) => mockPromise(undefined),
    cancelStream: (requestId: string) => mockPromise(undefined),
    onStreamData: (requestId: string, callback: (data: string) => void) =>
      onPush(`model-pool:stream:${requestId}:data`, callback),
    onStreamDone: (requestId: string, callback: () => void) =>
      onPushVoid(`model-pool:stream:${requestId}:done`, callback),
    onStreamError: (requestId: string, callback: (error: string) => void) =>
      onPush(`model-pool:stream:${requestId}:error`, callback),
    onStreamAbort: (requestId: string, callback: () => void) =>
      onPushVoid(`model-pool:stream:${requestId}:abort`, callback),
  },

  feishu: {
    install: {
      verify: (appId: string, appSecret: string) => mockPromise({ success: true }),
    },
  },

  dingtalk: {
    install: {
      qrcode: () =>
        mockPromise({ deviceCode: 'mock-device-code', qrcodeUrl: 'https://example.com' }),
      poll: (deviceCode: string) => mockPromise({ status: 'pending' }),
      verify: (clientId: string, clientSecret: string) => mockPromise({ success: true }),
    },
  },

  githubCopilot: {
    requestDeviceCode: () =>
      mockPromise({
        deviceCode: 'mock-device-code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        interval: 5,
        expiresIn: 900,
      }),
    pollForToken: (deviceCode: string, interval: number, expiresIn: number) =>
      mockPromise({ status: 'pending' }),
    cancelPolling: () => mockPromise(undefined),
    signOut: () => mockPromise(undefined),
    refreshToken: () => mockPromise({ token: 'new-token' }),
    onTokenUpdated: (callback: (data: any) => void) =>
      onPush('github-copilot:token-updated', callback),
  },

  openaiCodexOAuth: {
    start: () => mockPromise({ authUrl: 'https://example.com/auth' }),
    cancel: () => mockPromise(undefined),
    logout: () => mockPromise(undefined),
    status: () => mockPromise({ authenticated: false }),
  },

  activity: {
    list: () => success({ runs: [] }),
    onUpdated: (callback: (run: any) => void) => onPush('activity:updated', callback),
  },
};
