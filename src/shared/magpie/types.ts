export const MagpieIpc = {
  status: 'magpie:status',
  start: 'magpie:start',
  stop: 'magpie:stop',
  agents: 'magpie:agents',
  setModel: 'magpie:setModel',
  previewAgent: 'magpie:previewAgent',
  connectAgent: 'magpie:connectAgent',
  disconnectAgent: 'magpie:disconnectAgent',
  disconnectAllAgents: 'magpie:disconnectAllAgents',
  models: 'magpie:models',
  openManagement: 'magpie:openManagement',
  catalog: 'magpie:catalog',
  selectDefault: 'magpie:selectDefault',
  setSubscriptionAccounts: 'magpie:setSubscriptionAccounts',
  providers: 'magpie:providers',
  saveProvider: 'magpie:saveProvider',
  setProviderEnabled: 'magpie:setProviderEnabled',
  deleteProvider: 'magpie:deleteProvider',
  testProvider: 'magpie:testProvider',
  diagnostics: 'magpie:diagnostics',
} as const;

export type MagpieProviderApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export interface MagpieProviderSummary {
  id: string;
  name: string;
  api: MagpieProviderApi;
  baseUrl: string;
  models: string[];
  off: boolean;
  isHostManaged?: boolean;
  hasKey: boolean;
  keyMasked?: string;
  fallback?: string[];
  chat?: string;
  responses?: string;
  anthropic?: string;
}

export interface MagpieSaveProviderInput {
  id?: string;
  name: string;
  api: MagpieProviderApi;
  baseUrl: string;
  key?: string;
  models: string[];
  fallback?: string[];
}

export interface MagpieTestProviderResult {
  ok: boolean;
  latencyMs?: number;
  modelCount?: number;
  error?: string;
}

export interface MagpieDiagnosticSummary {
  latencyMs?: number;
  activeProviderCount: number;
  recentErrors?: { timestamp: number; message: string; providerId?: string }[];
}

export interface MagpieStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  version: string;
  gatewayUrl?: string;
  /** Persisted user authorization to run the service, separate from current process state. */
  enabled?: boolean;
  subscriptionAccountsEnabled?: boolean;
  error?: string;
  diagnostics?: MagpieDiagnosticSummary;
}
export interface MagpieModel {
  id: string;
  owned_by?: string;
  display_name?: string;
  native_endpoints?: string[];
  context_window?: number;
  max_output_tokens?: number;
  reasoning?: boolean;
  supported_reasoning_levels?: { effort: string }[];
  modalities?: { input: string[]; output: string[] };
}
export interface MagpieModelCatalog {
  status: MagpieStatus;
  models: MagpieModel[];
  defaultModelId: string | null;
}
/** @knipignore Referenced only by a dynamic import() type query in electron.d.ts. */
export interface MagpieApi {
  status(): Promise<MagpieStatus>;
  start(): Promise<MagpieStatus>;
  stop(): Promise<MagpieStatus>;
  agents(): Promise<MagpieAgents>;
  setModel(selection: MagpieModelSelection): Promise<MagpieAgents>;
  previewAgent(agentId: string): Promise<MagpieAgentConnectPreview>;
  connectAgent(agentId: string): Promise<MagpieAgents>;
  disconnectAgent(agentId: string): Promise<MagpieAgents>;
  disconnectAllAgents(): Promise<MagpieAgents>;
  models(): Promise<MagpieModel[]>;
  openManagement(): Promise<void>;
  catalog(): Promise<MagpieModelCatalog>;
  selectDefault(modelId: string): Promise<MagpieModelCatalog>;
  setSubscriptionAccounts(enabled: boolean): Promise<MagpieStatus>;
  providers(): Promise<MagpieProviderSummary[]>;
  saveProvider(input: MagpieSaveProviderInput): Promise<MagpieProviderSummary[]>;
  setProviderEnabled(id: string, enabled: boolean): Promise<MagpieProviderSummary[]>;
  deleteProvider(id: string): Promise<MagpieProviderSummary[]>;
  testProvider(input: MagpieSaveProviderInput): Promise<MagpieTestProviderResult>;
  diagnostics(): Promise<MagpieDiagnosticSummary>;
}

export interface MagpieAgent {
  id: string;
  name: string;
  cliMissing: boolean;
  wired: boolean;
  version?: string;
  appVersion?: string;
  models: {
    key: string;
    label: string;
    value: string;
    options: { value: string; label?: string }[];
  }[];
}
export interface MagpieAgents {
  agents: MagpieAgent[];
  pending: boolean;
}
export interface MagpieModelSelection {
  agentId: string;
  field: string;
  value: string;
}

export interface MagpieAgentFileChange {
  path: string;
  removed?: boolean;
  created?: boolean;
  lines?: { op?: string; text?: string; was?: string }[];
}

export interface MagpieAgentConnectPreview {
  changes: MagpieAgentFileChange[];
  error?: string;
  revision?: string;
}
