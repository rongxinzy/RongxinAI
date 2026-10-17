/**
 * Skills and MCP preload surface, split from `../electron.d.ts`.
 *
 * Contains the skill catalog/install APIs (plus their email connectivity
 * probe result types) and the MCP server/marketplace APIs.
 */

interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  pinned: boolean;
  isOfficial: boolean;
  isBuiltIn: boolean;
  updatedAt: number;
  prompt: string;
  skillPath: string;
  iconUrl?: string;
  displayName?: string;
  displayDescription?: string;
  displayAuthor?: string;
  displayLicense?: string;
  metadataContent?: string;
  metadataFields?: Record<string, string>;
  version?: string;
}

type EmailConnectivityCheckCode = 'imap_connection' | 'smtp_connection';
type EmailConnectivityCheckLevel = 'pass' | 'fail';
type EmailConnectivityVerdict = 'pass' | 'fail';

interface EmailConnectivityCheck {
  code: EmailConnectivityCheckCode;
  level: EmailConnectivityCheckLevel;
  message: string;
  durationMs: number;
}

interface EmailConnectivityTestResult {
  testedAt: number;
  verdict: EmailConnectivityVerdict;
  checks: EmailConnectivityCheck[];
}

interface McpServerConfigIPC {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  transportType: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  isBuiltIn: boolean;
  githubUrl?: string;
  registryId?: string;
  createdAt: number;
  updatedAt: number;
}

interface McpMarketplaceServer {
  id: string;
  name: string;
  description_zh: string;
  description_en: string;
  category: string;
  transportType: 'stdio' | 'sse' | 'http';
  descriptionKey?: string;
  categoryKey?: string;
  command?: string;
  defaultArgs?: string[];
  url?: string;
  headers?: Record<string, string>;
  authType?: 'oauth' | 'cli' | 'token' | 'external';
  connectorPath?: string;
  iconPath?: string;
  metadataPath?: string;
  requiredEnvKeys?: string[];
  optionalEnvKeys?: string[];
  presentation?: {
    name?: string;
    authorization?: string;
    zh?: {
      description?: string;
      connect?: Record<string, { title?: string; description?: string }>;
    };
    en?: {
      description?: string;
      connect?: Record<string, { title?: string; description?: string }>;
    };
  };
}

interface McpMarketplaceCategory {
  id: string;
  name_zh: string;
  name_en: string;
}

interface McpMarketplaceData {
  categories: McpMarketplaceCategory[];
  servers: McpMarketplaceServer[];
}

interface McpConnectionTestResult {
  success: boolean;
  error?: string;
  toolCount?: number;
}

export interface SkillsApi {
  list: () => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
  setEnabled: (options: {
    id: string;
    enabled: boolean;
  }) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
  setEnabledBatch?: (options: {
    ids: string[];
    enabled: boolean;
  }) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
  setPinned: (options: {
    id: string;
    pinned: boolean;
  }) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
  delete: (id: string) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
  download: (
    source: string,
    options?: { iconUrl?: string; displayName?: string },
  ) => Promise<{
    success: boolean;
    skills?: Skill[];
    error?: string;
    errorCode?: string;
    auditReport?: any;
    pendingInstallId?: string;
  }>;
  confirmInstall: (
    pendingId: string,
    action: string,
  ) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
  getRoot: () => Promise<{ success: boolean; path?: string; error?: string }>;
  getContent: (skillId: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  autoRoutingPrompt: () => Promise<{ success: boolean; prompt?: string | null; error?: string }>;
  getConfig: (
    skillId: string,
  ) => Promise<{ success: boolean; config?: Record<string, string>; error?: string }>;
  setConfig: (
    skillId: string,
    config: Record<string, string>,
  ) => Promise<{ success: boolean; error?: string }>;
  testEmailConnectivity: (
    skillId: string,
    config: Record<string, string>,
  ) => Promise<{ success: boolean; result?: EmailConnectivityTestResult; error?: string }>;
  fetchMarketplace: (options?: {
    pageNumber?: number;
    pageSize?: number;
  }) => Promise<{ success: boolean; data?: string; error?: string }>;
  fetchMarketplaceContent: (skillId: string) => Promise<{
    success: boolean;
    content?: string | null;
    error?: string;
  }>;
  onChanged: (callback: () => void) => () => void;
}

export interface McpApi {
  list: () => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
  create: (
    data: any,
  ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
  update: (
    id: string,
    data: any,
  ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
  delete: (
    id: string,
  ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
  setEnabled: (options: {
    id: string;
    enabled: boolean;
  }) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
  testConnection: (data: any) => Promise<McpConnectionTestResult>;
  fetchMarketplace: () => Promise<{
    success: boolean;
    data?: McpMarketplaceData;
    error?: string;
  }>;
  refreshBridge: () => Promise<{ success: boolean; tools: number; error?: string }>;
  authorize: (
    data: any,
  ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
  cancelAuthorize: (requestId: string) => Promise<{ success: boolean }>;
  getFeishuCliStatus: () => Promise<{ success: boolean; installed: boolean; error?: string }>;
  prepareFeishuCli: () => Promise<{ success: boolean; error?: string }>;
  loadIcon: (iconPath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  exportConfig: () => Promise<{ success: boolean; cancelled?: boolean; error?: string }>;
  importConfig: () => Promise<{
    success: boolean;
    cancelled?: boolean;
    servers?: McpServerConfigIPC[];
    error?: string;
  }>;
  onBridgeSyncStart: (callback: () => void) => () => void;
  onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) => () => void;
}
