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

// ─── Todo ───────────────────────────────────────────────────────────────────
export {
  TodoIpc,
  type TodoIpc as TodoIpcChannel,
} from '../todo/constants';

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

// ─── API (HTTP proxy) ───────────────────────────────────────────────────────
export const ApiIpc = {
  Fetch: 'api:fetch',
  FetchModels: 'api:fetch-models',
  WebSearch: 'api:web-search',
  Stream: 'api:stream',
  CancelStream: 'api:stream:cancel',
  /** Dynamic: `api:stream:${requestId}:data` */
  streamData: (requestId: string) => `api:stream:${requestId}:data`,
  streamDone: (requestId: string) => `api:stream:${requestId}:done`,
  streamError: (requestId: string) => `api:stream:${requestId}:error`,
  streamAbort: (requestId: string) => `api:stream:${requestId}:abort`,
} as const;

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
} as const;
export type WindowIpc = (typeof WindowIpc)[keyof typeof WindowIpc];

// ─── App-level config ───────────────────────────────────────────────────────
export const AppConfigIpc = {
  GetApiConfig: 'get-api-config',
  CheckApiConfig: 'check-api-config',
  SaveApiConfig: 'save-api-config',
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
  Save: 'cowork:session:save',
  Delete: 'cowork:session:delete',
  DeleteBatch: 'cowork:session:deleteBatch',
  Pin: 'cowork:session:pin',
  Rename: 'cowork:session:rename',
  UpdateModel: 'cowork:session:updateModel',
  Get: 'cowork:session:get',
  RemoteManaged: 'cowork:session:remoteManaged',
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

// ─── Cowork Bootstrap ───────────────────────────────────────────────────────
export const CoworkBootstrapIpc = {
  Read: 'cowork:bootstrap:read',
  Write: 'cowork:bootstrap:write',
} as const;
export type CoworkBootstrapIpc = (typeof CoworkBootstrapIpc)[keyof typeof CoworkBootstrapIpc];

// ─── Cowork Stream ──────────────────────────────────────────────────────────
export const CoworkStreamIpc = {
  Message: 'cowork:stream:message',
  MessageUpdate: 'cowork:stream:messageUpdate',
  ToolActivity: 'cowork:stream:toolActivity',
  Permission: 'cowork:stream:permission',
  PermissionDismiss: 'cowork:stream:permissionDismiss',
  Interrupted: 'cowork:stream:interrupted',
  Complete: 'cowork:stream:complete',
  Error: 'cowork:stream:error',
  QueueUpdated: 'cowork:stream:queueUpdated',
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
} as const;
export type ShellIpc = (typeof ShellIpc)[keyof typeof ShellIpc];

// ─── App (lifecycle) ────────────────────────────────────────────────────────
export const AppIpc = {
  GetAutoLaunch: 'app:getAutoLaunch',
  SetAutoLaunch: 'app:setAutoLaunch',
  GetPreventSleep: 'app:getPreventSleep',
  SetPreventSleep: 'app:setPreventSleep',
  GetVersion: 'app:getVersion',
  GetSystemLocale: 'app:getSystemLocale',
  ConsumePendingLocalInferenceInstall: 'app:consumePendingLocalInferenceInstall',
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

// ─── IM ─────────────────────────────────────────────────────────────────────
export const ImIpc = {
  // Config
  ConfigGet: 'im:config:get',
  ConfigSet: 'im:config:set',
  ConfigSync: 'im:config:sync',
  // Gateway
  GatewayStart: 'im:gateway:start',
  GatewayStop: 'im:gateway:stop',
  GatewayTest: 'im:gateway:test',
  // Status
  StatusGet: 'im:status:get',
  GetLocalIp: 'im:getLocalIp',
  // Events
  StatusChange: 'im:status:change',
  MessageReceived: 'im:message:received',
} as const;
export type ImIpc = (typeof ImIpc)[keyof typeof ImIpc];

export const WeixinInstallIpc = {
  Start: 'im:weixin:login:start',
  Poll: 'im:weixin:login:poll',
} as const;
export type WeixinInstallIpc = (typeof WeixinInstallIpc)[keyof typeof WeixinInstallIpc];

// ─── IM Multi-Instance factories ────────────────────────────────────────────
export const ImInstanceIpc = {
  dingtalkAdd: 'im:dingtalk:instance:add',
  dingtalkDelete: 'im:dingtalk:instance:delete',
  dingtalkSetConfig: 'im:dingtalk:instance:config:set',
  qqAdd: 'im:qq:instance:add',
  qqDelete: 'im:qq:instance:delete',
  qqSetConfig: 'im:qq:instance:config:set',
  feishuAdd: 'im:feishu:instance:add',
  feishuDelete: 'im:feishu:instance:delete',
  feishuSetConfig: 'im:feishu:instance:config:set',
  wecomAdd: 'im:wecom:instance:add',
  wecomDelete: 'im:wecom:instance:delete',
  wecomSetConfig: 'im:wecom:instance:config:set',
  telegramAdd: 'im:telegram:instance:add',
  telegramDelete: 'im:telegram:instance:delete',
  telegramSetConfig: 'im:telegram:instance:config:set',
  discordAdd: 'im:discord:instance:add',
  discordDelete: 'im:discord:instance:delete',
  discordSetConfig: 'im:discord:instance:config:set',
} as const;
export type ImInstanceIpc = (typeof ImInstanceIpc)[keyof typeof ImInstanceIpc];

// ─── Community Auth ─────────────────────────────────────────────────────────
export const CommunityAuthIpc = {
  Login: 'auth:communityLogin',
  GetCommunityUser: 'auth:getCommunityUser',
  Logout: 'auth:communityLogout',
  Callback: 'auth:communityCallback',
} as const;
export type CommunityAuthIpc = (typeof CommunityAuthIpc)[keyof typeof CommunityAuthIpc];

// ─── Feishu Install ─────────────────────────────────────────────────────────
export const FeishuInstallIpc = {
  Verify: 'feishu:install:verify',
} as const;
export type FeishuInstallIpc = (typeof FeishuInstallIpc)[keyof typeof FeishuInstallIpc];

// ─── DingTalk Install ───────────────────────────────────────────────────────
export const DingTalkInstallIpc = {
  Qrcode: 'dingtalk:install:qrcode',
  Poll: 'dingtalk:install:poll',
  Verify: 'dingtalk:install:verify',
} as const;
export type DingTalkInstallIpc = (typeof DingTalkInstallIpc)[keyof typeof DingTalkInstallIpc];

// ─── GitHub Copilot ─────────────────────────────────────────────────────────
export const GitHubCopilotIpc = {
  RequestDeviceCode: 'github-copilot:request-device-code',
  PollForToken: 'github-copilot:poll-for-token',
  CancelPolling: 'github-copilot:cancel-polling',
  SignOut: 'github-copilot:sign-out',
  RefreshToken: 'github-copilot:refresh-token',
  TokenUpdated: 'github-copilot:token-updated',
} as const;
export type GitHubCopilotIpc = (typeof GitHubCopilotIpc)[keyof typeof GitHubCopilotIpc];

// ─── OpenAI Codex OAuth ─────────────────────────────────────────────────────
export const OpenAICodexOAuthIpc = {
  Start: 'openai-codex-oauth:start',
  Cancel: 'openai-codex-oauth:cancel',
  Logout: 'openai-codex-oauth:logout',
  Status: 'openai-codex-oauth:status',
} as const;
export type OpenAICodexOAuthIpc = (typeof OpenAICodexOAuthIpc)[keyof typeof OpenAICodexOAuthIpc];

// ─── Network ────────────────────────────────────────────────────────────────
export const NetworkIpc = {
  StatusChange: 'network:status-change',
} as const;
export type NetworkIpc = (typeof NetworkIpc)[keyof typeof NetworkIpc];
