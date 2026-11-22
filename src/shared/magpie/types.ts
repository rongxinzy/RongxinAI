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
  /**
   * Windows the user declared for this provider's models: `"*"` covers every
   * model, a model id overrides one. Omitted when upstream has none.
   */
  contexts?: Record<string, number>;
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
  /**
   * `undefined` keeps whatever upstream has (a save that doesn't say);
   * `{}` clears every declared window. Values are token counts.
   */
  contexts?: Record<string, number>;
}

type MagpieTestProviderErrorCode =
  | 'html-endpoint'
  | 'not-json'
  | 'too-large'
  | 'api-error'
  | 'network'
  | 'http';

export interface MagpieTestProviderResult {
  ok: boolean;
  latencyMs?: number;
  modelCount?: number;
  discoveredModels?: string[];
  /** Per-model context windows reported by the upstream `/v1/models` endpoint. */
  discoveredModelContexts?: Record<string, number>;
  requiresKey?: boolean;
  error?: string;
  errorCode?: MagpieTestProviderErrorCode;
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
  /** Present for bare aliases with one matching canonical catalog row. */
  canonical_id?: string;
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
export interface MagpieAgent {
  id: string;
  name: string;
  cliMissing: boolean;
  wired: boolean;
  version?: string;
  appVersion?: string;
  /** Set when gateway reapply failed for a wired agent after service startup. */
  reapplyError?: string;
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
