/**
 * Centralized IPC channel name constants.
 *
 * Every Electron IPC channel name lives here as an `as const` object.
 * Types are derived from these values so that preload and main share a single source of truth.
 *
 * Pattern (matching existing ScheduledTaskIpc / OllamaIpcChannel convention):
 *   import { CoworkSessionIpc } from '@shared/ipc/channels';
 *   ipcRenderer.invoke(CoworkSessionIpc.Start, options);
 */

// ─── Store ──────────────────────────────────────────────────────────────────
export const CompanionIpc = {
  GetVisibility: 'companion:visibility:get',
  Focus: 'companion:focus',
  Bootstrap: 'companion:bootstrap',
  Select: 'companion:select',
  Submit: 'companion:submit',
  Answer: 'companion:answer',
  Stop: 'companion:stop',
  SubmitTask: 'companion:task:submit',
  Tasks: 'companion:tasks',
  TasksChanged: 'companion:tasks:changed',
  StopTask: 'companion:task:stop',
  ChooseWorkspace: 'companion:workspace:choose',
  ChooseFiles: 'companion:files:choose',
  StageFile: 'companion:files:stage',
  ListMemories: 'companion:memory:list',
  SaveMemory: 'companion:memory:save',
  ConfirmMemory: 'companion:memory:confirm',
  ForgetMemory: 'companion:memory:forget',
  ShareMemory: 'companion:memory:share',
  Hide: 'companion:hide',
  OpenWorkbench: 'companion:openWorkbench',
  Context: 'companion:context',
  Visibility: 'companion:visibility',
  Changed: 'companion:changed',
  Workbench: 'companion:workbench',
} as const;

export const StoreIpc = {
  Get: 'store:get',
  Set: 'store:set',
  Remove: 'store:remove',
} as const;
export type StoreIpc = (typeof StoreIpc)[keyof typeof StoreIpc];

// ─── Skills ─────────────────────────────────────────────────────────────────
export const SkillsIpc = {
  List: 'skills:list',
  SetEnabled: 'skills:setEnabled',
  SetEnabledBatch: 'skills:setEnabledBatch',
  SetPinned: 'skills:setPinned',
  Delete: 'skills:delete',
  Download: 'skills:download',
  ConfirmInstall: 'skills:confirmInstall',
  GetRoot: 'skills:getRoot',
  GetContent: 'skills:getContent',
  AutoRoutingPrompt: 'skills:autoRoutingPrompt',
  GetConfig: 'skills:getConfig',
  SetConfig: 'skills:setConfig',
  TestEmailConnectivity: 'skills:testEmailConnectivity',
  FetchMarketplace: 'skills:fetchMarketplace',
  FetchMarketplaceContent: 'skills:fetchMarketplaceContent',
  CreateCustom: 'skills:createCustom',
  Changed: 'skills:changed',
} as const;
export type SkillsIpc = (typeof SkillsIpc)[keyof typeof SkillsIpc];

// ─── MCP ────────────────────────────────────────────────────────────────────
export const McpIpc = {
  List: 'mcp:list',
  Create: 'mcp:create',
  Update: 'mcp:update',
  Delete: 'mcp:delete',
  SetEnabled: 'mcp:setEnabled',
  TestConnection: 'mcp:testConnection',
  FetchMarketplace: 'mcp:fetchMarketplace',
  RefreshBridge: 'mcp:refreshBridge',
  Authorize: 'mcp:authorize',
  CancelAuthorize: 'mcp:cancelAuthorize',
  GetFeishuCliStatus: 'mcp:feishuCliStatus',
  PrepareFeishuCli: 'mcp:prepareFeishuCli',
  LoadIcon: 'mcp:loadIcon',
  ExportConfig: 'mcp:exportConfig',
  ImportConfig: 'mcp:importConfig',
  ImportConfigContent: 'mcp:importConfigContent',
  BridgeSyncStart: 'mcp:bridge:syncStart',
  BridgeSyncDone: 'mcp:bridge:syncDone',
} as const;
export type McpIpc = (typeof McpIpc)[keyof typeof McpIpc];

// ─── Hardware ───────────────────────────────────────────────────────────────
export const HardwareIpc = {
  NvidiaSmi: 'hardware:nvidia-smi',
  SystemMemory: 'hardware:system-memory',
} as const;
export type HardwareIpc = (typeof HardwareIpc)[keyof typeof HardwareIpc];

// ─── Permissions ────────────────────────────────────────────────────────────
export const PermissionsIpc = {
  CheckCalendar: 'permissions:checkCalendar',
  RequestCalendar: 'permissions:requestCalendar',
} as const;
export type PermissionsIpc = (typeof PermissionsIpc)[keyof typeof PermissionsIpc];

// ─── Enterprise ─────────────────────────────────────────────────────────────
export const EnterpriseIpc = {
  GetConfig: 'enterprise:getConfig',
} as const;
export type EnterpriseIpc = (typeof EnterpriseIpc)[keyof typeof EnterpriseIpc];

export const ManagedProviderIpc = {
  Policy: 'enterprise:managed-provider:policy',
  Catalog: 'enterprise:managed-provider:catalog',
  Changed: 'enterprise:managed-provider:changed',
} as const;
export type ManagedProviderIpc = (typeof ManagedProviderIpc)[keyof typeof ManagedProviderIpc];

// ─── ZhiYuan Model Pool ────────────────────────────────────────────────────
export const ModelPoolIpc = {
  ListModels: 'model-pool:list-models',
  Stream: 'model-pool:stream',
  CancelStream: 'model-pool:stream:cancel',
  streamData: (requestId: string) => `model-pool:stream:${requestId}:data`,
  streamDone: (requestId: string) => `model-pool:stream:${requestId}:done`,
  streamError: (requestId: string) => `model-pool:stream:${requestId}:error`,
  streamAbort: (requestId: string) => `model-pool:stream:${requestId}:abort`,
} as const;
export type ModelPoolIpc = (typeof ModelPoolIpc)[keyof typeof ModelPoolIpc];

// ─── Window ─────────────────────────────────────────────────────────────────
export const WindowIpc = {
  Minimize: 'window-minimize',
  ToggleMaximize: 'window-maximize',
  Close: 'window-close',
  IsMaximized: 'window:isMaximized',
  ShowSystemMenu: 'window:showSystemMenu',
  StateChanged: 'window:state-changed',
  ToggleDevTools: 'window:toggleDevTools',
  OpenDevTools: 'window:openDevTools',
} as const;
export type WindowIpc = (typeof WindowIpc)[keyof typeof WindowIpc];

export const ContextMenuIpc = {
  Open: 'context-menu:open',
  Execute: 'context-menu:execute',
} as const;
export type ContextMenuIpc = (typeof ContextMenuIpc)[keyof typeof ContextMenuIpc];

// ─── App-level config ───────────────────────────────────────────────────────
export const AppConfigIpc = {
  CheckApiConfig: 'check-api-config',
  GenerateSessionTitle: 'generate-session-title',
  GetRecentCwds: 'get-recent-cwds',
} as const;
export type AppConfigIpc = (typeof AppConfigIpc)[keyof typeof AppConfigIpc];

// ─── Agent Engine ──────────────────────────────────────────────────────────
// ─── Cowork Session ─────────────────────────────────────────────────────────
export const CoworkSessionIpc = {
  Start: 'cowork:session:start',
  Continue: 'cowork:session:continue',
  Stop: 'cowork:session:stop',
  Compact: 'cowork:session:compact',
  Save: 'cowork:session:save',
  Delete: 'cowork:session:delete',
  DeleteBatch: 'cowork:session:deleteBatch',
  Pin: 'cowork:session:pin',
  Rename: 'cowork:session:rename',
  UpdateModel: 'cowork:session:updateModel',
  Get: 'cowork:session:get',
  RunSnapshot: 'cowork:session:runSnapshot',
  List: 'cowork:session:list',
  GetMessages: 'cowork:session:getMessages',
  ExportResultImage: 'cowork:session:exportResultImage',
  CaptureImageChunk: 'cowork:session:captureImageChunk',
  SaveResultImage: 'cowork:session:saveResultImage',
  ExportText: 'cowork:session:exportText',
} as const;
export type CoworkSessionIpc = (typeof CoworkSessionIpc)[keyof typeof CoworkSessionIpc];

// 鈹€鈹€鈹€ Cowork pending Work messages 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
export const CoworkQueueIpc = {
  List: 'cowork:queue:list',
  Enqueue: 'cowork:queue:enqueue',
  Update: 'cowork:queue:update',
  Delete: 'cowork:queue:delete',
  Steer: 'cowork:queue:steer',
  FollowUp: 'cowork:queue:followUp',
} as const;
export type CoworkQueueIpc = (typeof CoworkQueueIpc)[keyof typeof CoworkQueueIpc];

// ─── Cowork Permission ──────────────────────────────────────────────────────
export const CoworkPermissionIpc = {
  Respond: 'cowork:permission:respond',
} as const;
export type CoworkPermissionIpc = (typeof CoworkPermissionIpc)[keyof typeof CoworkPermissionIpc];

// ─── Cowork Config ──────────────────────────────────────────────────────────
export const CoworkConfigIpc = {
  Get: 'cowork:config:get',
  Set: 'cowork:config:set',
} as const;
export type CoworkConfigIpc = (typeof CoworkConfigIpc)[keyof typeof CoworkConfigIpc];

// ─── Cowork Stream ──────────────────────────────────────────────────────────
export const CoworkStreamIpc = {
  RunState: 'cowork:stream:runState',
  RuntimeSnapshots: 'cowork:stream:runtimeSnapshots',
  UiEvent: 'cowork:stream:uiEvent',
  StreamResync: 'cowork:stream:resync',
  SessionsChanged: 'cowork:sessions:changed',
} as const;
export type CoworkStreamIpc = (typeof CoworkStreamIpc)[keyof typeof CoworkStreamIpc];

// ─── Project (working directory helpers) ────────────────────────────────────
export const ProjectIpc = {
  GetDefaultBaseDir: 'project:getDefaultBaseDir',
  CreateDirectory: 'project:createDirectory',
  EnsureScratchDir: 'project:ensureScratchDir',
  CreateRandomWorkspace: 'project:createRandomWorkspace',
} as const;
export type ProjectIpc = (typeof ProjectIpc)[keyof typeof ProjectIpc];

// ─── Dialog ─────────────────────────────────────────────────────────────────
export const DialogIpc = {
  SelectDirectory: 'dialog:selectDirectory',
  SelectFile: 'dialog:selectFile',
  SelectFiles: 'dialog:selectFiles',
  SaveInlineFile: 'dialog:saveInlineFile',
  ReadFileAsDataUrl: 'dialog:readFileAsDataUrl',
  CheckArtifactFile: 'dialog:checkArtifactFile',
  GenerateThumbnail: 'dialog:generateThumbnail',
  ShowMessageBox: 'dialog:showMessageBox',
} as const;
export type DialogIpc = (typeof DialogIpc)[keyof typeof DialogIpc];

// ─── Shell ──────────────────────────────────────────────────────────────────
export const ShellIpc = {
  OpenPath: 'shell:openPath',
  ShowItemInFolder: 'shell:showItemInFolder',
  OpenExternal: 'shell:openExternal',
  OpenHtmlInBrowser: 'shell:openHtmlInBrowser',
  ResolveLocalPath: 'shell:resolveLocalPath',
} as const;
export type ShellIpc = (typeof ShellIpc)[keyof typeof ShellIpc];

// ─── App (lifecycle) ────────────────────────────────────────────────────────
export const AppIpc = {
  GetAutoLaunch: 'app:getAutoLaunch',
  SetAutoLaunch: 'app:setAutoLaunch',
  GetPreventSleep: 'app:getPreventSleep',
  SetPreventSleep: 'app:setPreventSleep',
  GetVersion: 'app:getVersion',
  GetInferenceEdition: 'app:getInferenceEdition',
  UsesBundledLlamaCppRuntime: 'app:usesBundledLlamaCppRuntime',
  IsDev: 'app:isDev',
  IsEnterprise: 'app:isEnterprise',
  GetSystemLocale: 'app:getSystemLocale',
  Relaunch: 'app:relaunch',
} as const;
export type AppIpc = (typeof AppIpc)[keyof typeof AppIpc];

// ─── Log ────────────────────────────────────────────────────────────────────
export const LogIpc = {
  GetPath: 'log:getPath',
  OpenFolder: 'log:openFolder',
  ExportZip: 'log:exportZip',
  FromRenderer: 'log:fromRenderer',
} as const;
export type LogIpc = (typeof LogIpc)[keyof typeof LogIpc];

// ─── Community Auth ─────────────────────────────────────────────────────────
export const CommunityAuthIpc = {
  Login: 'auth:communityLogin',
  GetCommunityUser: 'auth:getCommunityUser',
  Logout: 'auth:communityLogout',
  Callback: 'auth:communityCallback',
} as const;
export type CommunityAuthIpc = (typeof CommunityAuthIpc)[keyof typeof CommunityAuthIpc];

// ─── Network ────────────────────────────────────────────────────────────────
export const NetworkIpc = {
  StatusChange: 'network:status-change',
} as const;
export type NetworkIpc = (typeof NetworkIpc)[keyof typeof NetworkIpc];

// ─── Agent runtime notices ──────────────────────────────────────────────────
/** Transient runtime status the renderer shows once and never persists. */
export const RuntimeNoticeIpc = {
  Notice: 'runtime:notice',
} as const;
export type RuntimeNoticeIpc = (typeof RuntimeNoticeIpc)[keyof typeof RuntimeNoticeIpc];

// ─── Artifact ledger ────────────────────────────────────────────────────────
/** Event-time artifact upserts (main → renderer) and ledger list reads. */
export const ArtifactIpc = {
  Upsert: 'artifact:upsert',
  List: 'artifact:list',
} as const;
export type ArtifactIpc = (typeof ArtifactIpc)[keyof typeof ArtifactIpc];
