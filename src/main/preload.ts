import { contextBridge, ipcRenderer } from 'electron';

import type { CoworkError } from '../common/coworkError';
import { IpcChannel as ScheduledTaskIpc } from '../scheduledTask/constants';
import { AgentIpcChannel } from '../shared/agent/constants';
import { AppUpdateIpc } from '../shared/appUpdate/constants';
import {
  ApiIpc,
  AppConfigIpc,
  AppIpc,
  AuthIpc,
  CoworkBootstrapIpc,
  CoworkConfigIpc,
  CoworkMemoryIpc,
  CoworkPermissionIpc,
  CoworkSessionIpc,
  CoworkStreamIpc,
  DialogIpc,
  DingTalkInstallIpc,
  EnterpriseIpc,
  FeishuInstallIpc,
  GitHubCopilotIpc,
  HardwareIpc,
  ImInstanceIpc,
  ImIpc,
  LogIpc,
  McpIpc,
  NetworkIpc,
  OpenAICodexOAuthIpc,
  OpenClawEngineIpc,
  PermissionsIpc,
  ShellIpc,
  SkillsIpc,
  StoreIpc,
  WindowIpc,
} from '../shared/ipc/channels';
import { LlamaCppIpcChannel } from '../shared/llamacpp/constants';
import { MarketplaceIpcChannel } from '../shared/marketplace/constants';
import { OllamaIpcChannel } from '../shared/ollama/constants';
import type { Platform } from '../shared/platform';
import { TriageIpcChannel } from '../shared/triage';
import { OpenClawSessionIpc } from './openclawSession/constants';
import { OpenClawSessionPolicyIpc } from './openclawSessionPolicy/constants';

// Helper: typed main→renderer push listener with automatic cleanup
const onPush = <T>(
  channel: string,
  callback: (data: T) => void,
): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
};

// Helper: typed main→renderer push listener with no data payload
const onPushVoid = (
  channel: string,
  callback: () => void,
): (() => void) => {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
};

// ─── Exposed API ────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  arch: process.arch,

  store: {
    get: (key: string) => ipcRenderer.invoke(StoreIpc.Get, key),
    set: (key: string, value: unknown) => ipcRenderer.invoke(StoreIpc.Set, key, value),
    remove: (key: string) => ipcRenderer.invoke(StoreIpc.Remove, key),
  },

  skills: {
    list: () => ipcRenderer.invoke(SkillsIpc.List),
    setEnabled: (options: { id: string; enabled: boolean }) =>
      ipcRenderer.invoke(SkillsIpc.SetEnabled, options),
    delete: (id: string) => ipcRenderer.invoke(SkillsIpc.Delete, id),
    download: (source: string) => ipcRenderer.invoke(SkillsIpc.Download, source),
    confirmInstall: (pendingId: string, action: string) =>
      ipcRenderer.invoke(SkillsIpc.ConfirmInstall, pendingId, action),
    getRoot: () => ipcRenderer.invoke(SkillsIpc.GetRoot),
    autoRoutingPrompt: () => ipcRenderer.invoke(SkillsIpc.AutoRoutingPrompt),
    getConfig: (skillId: string) => ipcRenderer.invoke(SkillsIpc.GetConfig, skillId),
    setConfig: (skillId: string, config: Record<string, string>) =>
      ipcRenderer.invoke(SkillsIpc.SetConfig, skillId, config),
    testEmailConnectivity: (skillId: string, config: Record<string, string>) =>
      ipcRenderer.invoke(SkillsIpc.TestEmailConnectivity, skillId, config),
    fetchMarketplace: () => ipcRenderer.invoke(SkillsIpc.FetchMarketplace),
    onChanged: (callback: () => void) => onPushVoid(SkillsIpc.Changed, callback),
  },

  mcp: {
    list: () => ipcRenderer.invoke(McpIpc.List),
    create: (data: unknown) => ipcRenderer.invoke(McpIpc.Create, data),
    update: (id: string, data: unknown) => ipcRenderer.invoke(McpIpc.Update, id, data),
    delete: (id: string) => ipcRenderer.invoke(McpIpc.Delete, id),
    setEnabled: (options: { id: string; enabled: boolean }) =>
      ipcRenderer.invoke(McpIpc.SetEnabled, options),
    testConnection: (data: unknown) => ipcRenderer.invoke(McpIpc.TestConnection, data),
    fetchMarketplace: () => ipcRenderer.invoke(McpIpc.FetchMarketplace),
    refreshBridge: () => ipcRenderer.invoke(McpIpc.RefreshBridge),
    onBridgeSyncStart: (callback: () => void) =>
      onPushVoid(McpIpc.BridgeSyncStart, callback),
    onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) =>
      onPush(McpIpc.BridgeSyncDone, callback),
  },

  ollama: {
    status: () => ipcRenderer.invoke(OllamaIpcChannel.Status),
    install: () => ipcRenderer.invoke(OllamaIpcChannel.Install),
    start: () => ipcRenderer.invoke(OllamaIpcChannel.Start),
    stop: () => ipcRenderer.invoke(OllamaIpcChannel.Stop),
    restart: () => ipcRenderer.invoke(OllamaIpcChannel.Restart),
    getServiceConfig: () => ipcRenderer.invoke(OllamaIpcChannel.GetServiceConfig),
    setServiceConfig: (config: unknown) =>
      ipcRenderer.invoke(OllamaIpcChannel.SetServiceConfig, config),
    modelsDir: () => ipcRenderer.invoke(OllamaIpcChannel.ModelsDir),
    listLocalModels: () => ipcRenderer.invoke(OllamaIpcChannel.ListLocalModels),
    listRunningModels: () => ipcRenderer.invoke(OllamaIpcChannel.ListRunningModels),
    deleteModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.DeleteModel, name),
    showModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.ShowModel, name),
    createModel: (name: string, modelfile: string) =>
      ipcRenderer.invoke(OllamaIpcChannel.CreateModel, name, modelfile),
    preloadModel: (input: unknown) => ipcRenderer.invoke(OllamaIpcChannel.PreloadModel, input),
    unloadModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.UnloadModel, name),
    pullModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.PullModel, name),
    cancelPull: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.CancelPull, name),
    chat: (payload: unknown) => ipcRenderer.invoke(OllamaIpcChannel.Chat, payload),
    chatStream: (requestId: string, payload: unknown) =>
      ipcRenderer.invoke(OllamaIpcChannel.ChatStream, requestId, payload),
    cancelChatStream: (requestId: string) =>
      ipcRenderer.invoke(OllamaIpcChannel.CancelChatStream, requestId),
    setOpenClawModel: (modelName: string) =>
      ipcRenderer.invoke(OllamaIpcChannel.SetOpenClawModel, modelName),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush(OllamaIpcChannel.StatusChanged, callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush(OllamaIpcChannel.InstallProgress, callback),
    onPullProgress: (callback: (payload: unknown) => void) =>
      onPush(OllamaIpcChannel.PullProgress, callback),
    onChatStreamChunk: (callback: (payload: unknown) => void) =>
      onPush(OllamaIpcChannel.ChatStreamChunk, callback),
  },

  llamacpp: {
    status: () => ipcRenderer.invoke(LlamaCppIpcChannel.Status),
    install: () => ipcRenderer.invoke(LlamaCppIpcChannel.Install),
    uninstallRuntime: () => ipcRenderer.invoke(LlamaCppIpcChannel.UninstallRuntime),
    listRuntimeDevices: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListRuntimeDevices),
    getRuntimeCapabilities: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetRuntimeCapabilities),
    importRuntime: () => ipcRenderer.invoke(LlamaCppIpcChannel.ImportRuntime),
    fetchWindowsRuntimeManifest: (url: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.FetchWindowsRuntimeManifest, url),
    start: () => ipcRenderer.invoke(LlamaCppIpcChannel.Start),
    stop: () => ipcRenderer.invoke(LlamaCppIpcChannel.Stop),
    restart: () => ipcRenderer.invoke(LlamaCppIpcChannel.Restart),
    getServiceConfig: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetServiceConfig),
    setServiceConfig: (config: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetServiceConfig, config),
    modelsDir: () => ipcRenderer.invoke(LlamaCppIpcChannel.ModelsDir),
    listLocalModels: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListLocalModels),
    listRunningModels: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListRunningModels),
    deleteModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.DeleteModel, name),
    showModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.ShowModel, name),
    loadModel: (input: unknown) => ipcRenderer.invoke(LlamaCppIpcChannel.LoadModel, input),
    unloadModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.UnloadModel, name),
    installModel: (input: unknown) => ipcRenderer.invoke(LlamaCppIpcChannel.InstallModel, input),
    cancelInstall: (modelId: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.CancelInstall, modelId),
    pullModel: (name: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.InstallModel, { modelId: name, displayName: name }),
    cancelPull: (name: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.CancelInstall, name),
    chat: (payload: unknown) => ipcRenderer.invoke(LlamaCppIpcChannel.Chat, payload),
    chatStream: (requestId: string, payload: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.ChatStream, requestId, payload),
    cancelChatStream: (requestId: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.CancelChatStream, requestId),
    setOpenClawModel: (modelName: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetOpenClawModel, modelName),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush(LlamaCppIpcChannel.StatusChanged, callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush(LlamaCppIpcChannel.InstallProgress, callback),
    onPullProgress: (callback: (payload: { name: string; chunk: Record<string, unknown> }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: any) => {
        const name = String(progress?.modelId || progress?.modelName || '');
        callback({ name, chunk: { ...progress, status: progress?.phase } });
      };
      ipcRenderer.on(LlamaCppIpcChannel.InstallProgress, handler);
      return () => { ipcRenderer.removeListener(LlamaCppIpcChannel.InstallProgress, handler); };
    },
    onChatStreamChunk: (callback: (payload: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ChatStreamChunk, callback),
  },
  marketplace: {
    search: (params?: unknown) => ipcRenderer.invoke(MarketplaceIpcChannel.Search, params),
    getToken: () => ipcRenderer.invoke(MarketplaceIpcChannel.GetToken),
    setToken: (token: string) => ipcRenderer.invoke(MarketplaceIpcChannel.SetToken, token),
  },

  triage: {
    getConfig: () => ipcRenderer.invoke(TriageIpcChannel.GetConfig),
    setConfig: (config: unknown) => ipcRenderer.invoke(TriageIpcChannel.SetConfig, config),
  },

  hardware: {
    nvidiaSmi: () => ipcRenderer.invoke(HardwareIpc.NvidiaSmi),
  },

  permissions: {
    checkCalendar: () => ipcRenderer.invoke(PermissionsIpc.CheckCalendar),
    requestCalendar: () => ipcRenderer.invoke(PermissionsIpc.RequestCalendar),
  },

  enterprise: {
    getConfig: () => ipcRenderer.invoke(EnterpriseIpc.GetConfig),
  },

  api: {
    fetch: (options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }) => ipcRenderer.invoke(ApiIpc.Fetch, options),

    stream: (options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
      requestId: string;
    }) => ipcRenderer.invoke(ApiIpc.Stream, options),

    cancelStream: (requestId: string) =>
      ipcRenderer.invoke(ApiIpc.CancelStream, requestId),

    onStreamData: (requestId: string, callback: (chunk: string) => void) =>
      onPush<string>(ApiIpc.streamData(requestId), callback),

    onStreamDone: (requestId: string, callback: () => void) =>
      onPushVoid(ApiIpc.streamDone(requestId), callback),

    onStreamError: (requestId: string, callback: (error: CoworkError) => void) =>
      onPush<CoworkError>(ApiIpc.streamError(requestId), callback),

    onStreamAbort: (requestId: string, callback: () => void) =>
      onPushVoid(ApiIpc.streamAbort(requestId), callback),
  },

  // Internal app-level events (replaces raw ipcRenderer.on usage in App.tsx)
  appEvents: {
    onOpenSettings: (callback: () => void) => onPushVoid('app:openSettings', callback),
    onNewTask: (callback: () => void) => onPushVoid('app:newTask', callback),
  },

  window: {
    minimize: () => ipcRenderer.send(WindowIpc.Minimize),
    toggleMaximize: () => ipcRenderer.send(WindowIpc.ToggleMaximize),
    close: () => ipcRenderer.send(WindowIpc.Close),
    isMaximized: () => ipcRenderer.invoke(WindowIpc.IsMaximized),
    showSystemMenu: (position: { x: number; y: number }) =>
      ipcRenderer.send(WindowIpc.ShowSystemMenu, position),
    onStateChanged: (
      callback: (state: {
        isMaximized: boolean;
        isFullscreen: boolean;
        isFocused: boolean;
      }) => void,
    ) => onPush(WindowIpc.StateChanged, callback),
  },

  getApiConfig: () => ipcRenderer.invoke(AppConfigIpc.GetApiConfig),
  checkApiConfig: (options?: { probeModel?: boolean }) =>
    ipcRenderer.invoke(AppConfigIpc.CheckApiConfig, options),
  saveApiConfig: (config: {
    apiKey: string;
    baseURL: string;
    model: string;
    apiType?: 'anthropic' | 'openai';
  }) => ipcRenderer.invoke(AppConfigIpc.SaveApiConfig, config),
  generateSessionTitle: (userInput: string | null) =>
    ipcRenderer.invoke(AppConfigIpc.GenerateSessionTitle, userInput),
  getRecentCwds: (limit?: number) =>
    ipcRenderer.invoke(AppConfigIpc.GetRecentCwds, limit),

  openclaw: {
    engine: {
      getStatus: () => ipcRenderer.invoke(OpenClawEngineIpc.GetStatus),
      install: () => ipcRenderer.invoke(OpenClawEngineIpc.Install),
      retryInstall: () => ipcRenderer.invoke(OpenClawEngineIpc.RetryInstall),
      restartGateway: () => ipcRenderer.invoke(OpenClawEngineIpc.RestartGateway),
      onProgress: (callback: (status: unknown) => void) =>
        onPush(OpenClawEngineIpc.OnProgress, callback),
    },
    sessionPolicy: {
      get: () => ipcRenderer.invoke(OpenClawSessionPolicyIpc.Get),
      set: (config: { keepAlive: '1d' | '7d' | '30d' | '365d' }) =>
        ipcRenderer.invoke(OpenClawSessionPolicyIpc.Set, config),
    },
    session: {
      patch: (options: {
        sessionId: string;
        patch: {
          model?: string | null;
          thinkingLevel?: string | null;
          reasoningLevel?: string | null;
          elevatedLevel?: string | null;
          responseUsage?: 'off' | 'tokens' | 'full' | null;
          sendPolicy?: 'allow' | 'deny' | null;
        };
      }) => ipcRenderer.invoke(OpenClawSessionIpc.Patch, options),
    },
  },

  agents: {
    list: async () => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.List);
      return result?.success ? result.agents : [];
    },
    get: async (id: string) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Get, id);
      return result?.success ? result.agent : null;
    },
    create: async (request: {
      id?: string; name: string; description?: string; systemPrompt?: string;
      identity?: string; model?: string; workingDirectory?: string; icon?: string;
      skillIds?: string[]; source?: string; presetId?: string;
    }) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Create, request);
      return result?.success ? result.agent : null;
    },
    update: async (id: string, updates: {
      name?: string; description?: string; systemPrompt?: string; identity?: string;
      model?: string; workingDirectory?: string; icon?: string; skillIds?: string[];
      enabled?: boolean; pinned?: boolean;
    }) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Update, id, updates);
      return result?.success ? result.agent : null;
    },
    delete: async (id: string) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Delete, id);
      return result?.success ? result.deleted : false;
    },
    presets: async () => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Presets);
      return result?.success ? result.presets : [];
    },
    presetTemplates: async () => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.PresetTemplates);
      return result?.success ? result.presets : [];
    },
    addPreset: async (presetId: string) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.AddPreset, presetId);
      return result?.success ? result.agent : null;
    },
  },

  cowork: {
    startSession: (options: {
      prompt: string; cwd?: string; systemPrompt?: string; title?: string;
      activeSkillIds?: string[]; agentId?: string; modelOverride?: string;
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>;
    }) => ipcRenderer.invoke(CoworkSessionIpc.Start, options),

    continueSession: (options: {
      sessionId: string; prompt: string; systemPrompt?: string;
      activeSkillIds?: string[];
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>;
    }) => ipcRenderer.invoke(CoworkSessionIpc.Continue, options),

    stopSession: (sessionId: string) =>
      ipcRenderer.invoke(CoworkSessionIpc.Stop, sessionId),
    deleteSession: (sessionId: string) =>
      ipcRenderer.invoke(CoworkSessionIpc.Delete, sessionId),
    deleteSessions: (sessionIds: string[]) =>
      ipcRenderer.invoke(CoworkSessionIpc.DeleteBatch, sessionIds),
    setSessionPinned: (options: { sessionId: string; pinned: boolean }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Pin, options),
    renameSession: (options: { sessionId: string; title: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Rename, options),
    getSession: (sessionId: string) => ipcRenderer.invoke(CoworkSessionIpc.Get, sessionId),
    getGatewaySessionId: (sessionId: string) =>
      ipcRenderer.invoke(CoworkSessionIpc.GatewaySessionId, sessionId),
    remoteManaged: (sessionId: string) =>
      ipcRenderer.invoke(CoworkSessionIpc.RemoteManaged, sessionId),
    listSessions: (options?: { limit?: number; offset?: number; agentId?: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.List, options),
    getSessionMessages: (options: { sessionId: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke(CoworkSessionIpc.GetMessages, options),
    exportResultImage: (options: {
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }) => ipcRenderer.invoke(CoworkSessionIpc.ExportResultImage, options),
    captureImageChunk: (options: {
      rect: { x: number; y: number; width: number; height: number };
    }) => ipcRenderer.invoke(CoworkSessionIpc.CaptureImageChunk, options),
    saveResultImage: (options: { pngBase64: string; defaultFileName?: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.SaveResultImage, options),
    exportSessionText: (options: {
      content: string; defaultFileName?: string; fileExtension?: string;
    }) => ipcRenderer.invoke(CoworkSessionIpc.ExportText, options),

    respondToPermission: (options: { requestId: string; result: unknown }) =>
      ipcRenderer.invoke(CoworkPermissionIpc.Respond, options),

    getConfig: () => ipcRenderer.invoke(CoworkConfigIpc.Get),
    setConfig: (config: {
      workingDirectory?: string; executionMode?: 'auto' | 'local' | 'sandbox';
      agentEngine?: 'openclaw'; memoryEnabled?: boolean;
      memoryImplicitUpdateEnabled?: boolean; memoryLlmJudgeEnabled?: boolean;
      memoryGuardLevel?: 'strict' | 'standard' | 'relaxed';
      memoryUserMemoriesMaxItems?: number; skipMissedJobs?: boolean;
      embeddingEnabled?: boolean; embeddingProvider?: string; embeddingModel?: string;
      embeddingLocalModelPath?: string; embeddingVectorWeight?: number;
      embeddingRemoteBaseUrl?: string; embeddingRemoteApiKey?: string;
    }) => ipcRenderer.invoke(CoworkConfigIpc.Set, config),

    listMemoryEntries: (input: {
      query?: string; status?: 'created' | 'stale' | 'deleted' | 'all';
      includeDeleted?: boolean; limit?: number; offset?: number;
    }) => ipcRenderer.invoke(CoworkMemoryIpc.ListEntries, input),
    createMemoryEntry: (input: {
      text: string; confidence?: number; isExplicit?: boolean;
      source?: { sessionId?: string | null; role?: string; date?: string };
    }) => ipcRenderer.invoke(CoworkMemoryIpc.CreateEntry, input),
    updateMemoryEntry: (input: {
      id: string; text?: string; confidence?: number;
      status?: 'created' | 'stale' | 'deleted'; isExplicit?: boolean;
    }) => ipcRenderer.invoke(CoworkMemoryIpc.UpdateEntry, input),
    deleteMemoryEntry: (input: { id: string }) =>
      ipcRenderer.invoke(CoworkMemoryIpc.DeleteEntry, input),
    getMemoryStats: () => ipcRenderer.invoke(CoworkMemoryIpc.GetStats),
    readBootstrapFile: (filename: string) =>
      ipcRenderer.invoke(CoworkBootstrapIpc.Read, filename),
    writeBootstrapFile: (filename: string, content: string) =>
      ipcRenderer.invoke(CoworkBootstrapIpc.Write, filename, content),

    onStreamMessage: (callback: (data: { sessionId: string; message: unknown }) => void) =>
      onPush(CoworkStreamIpc.Message, callback),
    onStreamMessageUpdate: (
      callback: (data: {
        sessionId: string; messageId: string; content: string;
        metadata?: Record<string, unknown>;
      }) => void,
    ) => onPush(CoworkStreamIpc.MessageUpdate, callback),
    onStreamPermission: (
      callback: (data: { sessionId: string; request: unknown }) => void,
    ) => onPush(CoworkStreamIpc.Permission, callback),
    onStreamPermissionDismiss: (
      callback: (data: { requestId: string }) => void,
    ) => onPush(CoworkStreamIpc.PermissionDismiss, callback),
    onStreamComplete: (
      callback: (data: { sessionId: string; claudeSessionId: string | null }) => void,
    ) => onPush(CoworkStreamIpc.Complete, callback),
    onStreamError: (
      callback: (data: { sessionId: string; error: CoworkError }) => void,
    ) => onPush(CoworkStreamIpc.Error, callback),
    onSessionsChanged: (callback: (data: { sessionId?: string }) => void) =>
      onPush(CoworkStreamIpc.SessionsChanged, callback),
  },

  dialog: {
    selectDirectory: () => ipcRenderer.invoke(DialogIpc.SelectDirectory),
    selectFile: (options?: {
      title?: string; filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke(DialogIpc.SelectFile, options),
    selectFiles: (options?: {
      title?: string; filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke(DialogIpc.SelectFiles, options),
    saveInlineFile: (options: {
      dataBase64: string; fileName?: string; mimeType?: string; cwd?: string;
    }) => ipcRenderer.invoke(DialogIpc.SaveInlineFile, options),
    readFileAsDataUrl: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.ReadFileAsDataUrl, filePath),
    generateThumbnail: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.GenerateThumbnail, filePath),
    showMessageBox: (options: {
      message: string; type?: 'none' | 'info' | 'error' | 'question' | 'warning';
      title?: string;
    }) => ipcRenderer.invoke(DialogIpc.ShowMessageBox, options),
  },

  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke(ShellIpc.OpenPath, filePath),
    showItemInFolder: (filePath: string) =>
      ipcRenderer.invoke(ShellIpc.ShowItemInFolder, filePath),
    openExternal: (url: string) => ipcRenderer.invoke(ShellIpc.OpenExternal, url),
    openHtmlInBrowser: (htmlContent: string) =>
      ipcRenderer.invoke(ShellIpc.OpenHtmlInBrowser, htmlContent),
  },

  autoLaunch: {
    get: () => ipcRenderer.invoke(AppIpc.GetAutoLaunch),
    set: (enabled: boolean) => ipcRenderer.invoke(AppIpc.SetAutoLaunch, enabled),
  },

  preventSleep: {
    get: () => ipcRenderer.invoke(AppIpc.GetPreventSleep),
    set: (enabled: boolean) => ipcRenderer.invoke(AppIpc.SetPreventSleep, enabled),
  },

  appInfo: {
    getVersion: () => ipcRenderer.invoke(AppIpc.GetVersion),
    getSystemLocale: () => ipcRenderer.invoke(AppIpc.GetSystemLocale),
    relaunch: () => ipcRenderer.invoke(AppIpc.Relaunch),
  },

  appUpdate: {
    getState: () => ipcRenderer.invoke(AppUpdateIpc.GetState),
    checkNow: (options?: { manual?: boolean; userId?: string | null }) =>
      ipcRenderer.invoke(AppUpdateIpc.CheckNow, options),
    retryDownload: () => ipcRenderer.invoke(AppUpdateIpc.RetryDownload),
    cancelDownload: () => ipcRenderer.invoke(AppUpdateIpc.CancelDownload),
    installReady: () => ipcRenderer.invoke(AppUpdateIpc.InstallReady),
    onStateChanged: (callback: (data: unknown) => void) =>
      onPush(AppUpdateIpc.StateChanged, callback),
  },

  log: {
    getPath: () => ipcRenderer.invoke(LogIpc.GetPath),
    openFolder: () => ipcRenderer.invoke(LogIpc.OpenFolder),
    exportZip: () => ipcRenderer.invoke(LogIpc.ExportZip),
    fromRenderer: (level: string, tag: string, message: string) =>
      ipcRenderer.send(LogIpc.FromRenderer, level, tag, message),
  },

  im: {
    getConfig: () => ipcRenderer.invoke(ImIpc.ConfigGet),
    setConfig: (config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImIpc.ConfigSet, config, options),
    syncConfig: () => ipcRenderer.invoke(ImIpc.ConfigSync),

    startGateway: (platform: Platform) => ipcRenderer.invoke(ImIpc.GatewayStart, platform),
    stopGateway: (platform: Platform) => ipcRenderer.invoke(ImIpc.GatewayStop, platform),
    testGateway: (platform: Platform, configOverride?: unknown) =>
      ipcRenderer.invoke(ImIpc.GatewayTest, platform, configOverride),

    getStatus: () => ipcRenderer.invoke(ImIpc.StatusGet),
    getLocalIp: () => ipcRenderer.invoke(ImIpc.GetLocalIp) as Promise<string>,
    getOpenClawConfigSchema: () => ipcRenderer.invoke(ImIpc.OpenClawConfigSchema),

    weixinQrLoginStart: () => ipcRenderer.invoke(ImIpc.WeixinQrLoginStart),
    weixinQrLoginWait: (accountId?: string) =>
      ipcRenderer.invoke(ImIpc.WeixinQrLoginWait, accountId),

    listPairingRequests: (platform: string) =>
      ipcRenderer.invoke(ImIpc.PairingList, platform),
    approvePairingCode: (platform: string, code: string) =>
      ipcRenderer.invoke(ImIpc.PairingApprove, platform, code),
    rejectPairingRequest: (platform: string, code: string) =>
      ipcRenderer.invoke(ImIpc.PairingReject, platform, code),

    // Multi-Instance
    addDingTalkInstance: (name: string) =>
      ipcRenderer.invoke(ImInstanceIpc.dingtalkAdd, name),
    deleteDingTalkInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.dingtalkDelete, instanceId),
    setDingTalkInstanceConfig: (instanceId: string, config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImInstanceIpc.dingtalkSetConfig, instanceId, config, options),

    addQQInstance: (name: string) => ipcRenderer.invoke(ImInstanceIpc.qqAdd, name),
    deleteQQInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.qqDelete, instanceId),
    setQQInstanceConfig: (instanceId: string, config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImInstanceIpc.qqSetConfig, instanceId, config, options),

    addFeishuInstance: (name: string) => ipcRenderer.invoke(ImInstanceIpc.feishuAdd, name),
    deleteFeishuInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.feishuDelete, instanceId),
    setFeishuInstanceConfig: (instanceId: string, config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImInstanceIpc.feishuSetConfig, instanceId, config, options),

    addEmailInstance: (name: string) => ipcRenderer.invoke(ImInstanceIpc.emailAdd, name),
    deleteEmailInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.emailDelete, instanceId),
    setEmailInstanceConfig: (instanceId: string, config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImInstanceIpc.emailSetConfig, instanceId, config, options),

    addWecomInstance: (name: string) => ipcRenderer.invoke(ImInstanceIpc.wecomAdd, name),
    deleteWecomInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.wecomDelete, instanceId),
    setWecomInstanceConfig: (instanceId: string, config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImInstanceIpc.wecomSetConfig, instanceId, config, options),

    addTelegramInstance: (name: string) => ipcRenderer.invoke(ImInstanceIpc.telegramAdd, name),
    deleteTelegramInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.telegramDelete, instanceId),
    setTelegramInstanceConfig: (instanceId: string, config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImInstanceIpc.telegramSetConfig, instanceId, config, options),

    addDiscordInstance: (name: string) => ipcRenderer.invoke(ImInstanceIpc.discordAdd, name),
    deleteDiscordInstance: (instanceId: string) =>
      ipcRenderer.invoke(ImInstanceIpc.discordDelete, instanceId),
    setDiscordInstanceConfig: (instanceId: string, config: unknown, options?: { syncGateway?: boolean }) =>
      ipcRenderer.invoke(ImInstanceIpc.discordSetConfig, instanceId, config, options),

    onStatusChange: (callback: (status: unknown) => void) =>
      onPush(ImIpc.StatusChange, callback),
    onMessageReceived: (callback: (message: unknown) => void) =>
      onPush(ImIpc.MessageReceived, callback),
  },

  scheduledTasks: {
    list: () => ipcRenderer.invoke(ScheduledTaskIpc.List),
    get: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Get, id),
    create: (input: unknown) => ipcRenderer.invoke(ScheduledTaskIpc.Create, input),
    update: (id: string, input: unknown) =>
      ipcRenderer.invoke(ScheduledTaskIpc.Update, id, input),
    delete: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Delete, id),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(ScheduledTaskIpc.Toggle, id, enabled),

    runManually: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.RunManually, id),
    stop: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Stop, id),
    preflight: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Preflight, id),

    listRuns: (taskId: string, limit?: number, offset?: number, filter?: unknown) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ListRuns, taskId, limit, offset, filter),
    countRuns: (taskId: string) => ipcRenderer.invoke(ScheduledTaskIpc.CountRuns, taskId),
    listAllRuns: (limit?: number, offset?: number, filter?: unknown) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ListAllRuns, limit, offset, filter),
    resolveSession: (sessionKey: string) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ResolveSession, sessionKey),

    listChannels: () => ipcRenderer.invoke(ScheduledTaskIpc.ListChannels),
    listChannelConversations: (channel: string, accountId?: string, filterAccountId?: string) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ListChannelConversations, channel, accountId, filterAccountId),

    onStatusUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.StatusUpdate, callback),
    onRunUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.RunUpdate, callback),
    onRefresh: (callback: () => void) =>
      onPushVoid(ScheduledTaskIpc.Refresh, callback),
  },

  networkStatus: {
    send: (status: 'online' | 'offline') =>
      ipcRenderer.send(NetworkIpc.StatusChange, status),
  },

  auth: {
    login: (loginUrl?: string) => ipcRenderer.invoke(AuthIpc.Login, { loginUrl }),
    exchange: (code: string) => ipcRenderer.invoke(AuthIpc.Exchange, { code }),
    getUser: () => ipcRenderer.invoke(AuthIpc.GetUser),
    getQuota: () => ipcRenderer.invoke(AuthIpc.GetQuota),
    logout: () => ipcRenderer.invoke(AuthIpc.Logout),
    refreshToken: () => ipcRenderer.invoke(AuthIpc.RefreshToken),
    getAccessToken: () => ipcRenderer.invoke(AuthIpc.GetAccessToken),
    getModels: () => ipcRenderer.invoke(AuthIpc.GetModels),
    getProfileSummary: () => ipcRenderer.invoke(AuthIpc.GetProfileSummary),
    onCallback: (callback: (data: { code: string }) => void) =>
      onPush(AuthIpc.Callback, callback),
    onQuotaChanged: (callback: () => void) =>
      onPushVoid(AuthIpc.QuotaChanged, callback),
  },

  feishu: {
    install: {
      qrcode: (isLark: boolean) =>
        ipcRenderer.invoke(FeishuInstallIpc.Qrcode, { isLark }),
      poll: (deviceCode: string) =>
        ipcRenderer.invoke(FeishuInstallIpc.Poll, { deviceCode }),
      verify: (appId: string, appSecret: string) =>
        ipcRenderer.invoke(FeishuInstallIpc.Verify, { appId, appSecret }),
    },
  },

  dingtalk: {
    install: {
      qrcode: () => ipcRenderer.invoke(DingTalkInstallIpc.Qrcode),
      poll: (deviceCode: string) =>
        ipcRenderer.invoke(DingTalkInstallIpc.Poll, { deviceCode }),
      verify: (clientId: string, clientSecret: string) =>
        ipcRenderer.invoke(DingTalkInstallIpc.Verify, { clientId, clientSecret }),
    },
  },

  githubCopilot: {
    requestDeviceCode: () => ipcRenderer.invoke(GitHubCopilotIpc.RequestDeviceCode),
    pollForToken: (deviceCode: string, interval: number, expiresIn: number) =>
      ipcRenderer.invoke(GitHubCopilotIpc.PollForToken, { deviceCode, interval, expiresIn }),
    cancelPolling: () => ipcRenderer.invoke(GitHubCopilotIpc.CancelPolling),
    signOut: () => ipcRenderer.invoke(GitHubCopilotIpc.SignOut),
    refreshToken: () => ipcRenderer.invoke(GitHubCopilotIpc.RefreshToken),
    onTokenUpdated: (callback: (data: { token: string; baseUrl: string }) => void) =>
      onPush(GitHubCopilotIpc.TokenUpdated, callback),
  },

  openaiCodexOAuth: {
    start: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Start),
    cancel: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Cancel),
    logout: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Logout),
    status: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Status),
  },
});
