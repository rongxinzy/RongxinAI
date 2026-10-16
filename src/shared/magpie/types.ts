export const MagpieIpc = {
  status: 'magpie:status',
  start: 'magpie:start',
  stop: 'magpie:stop',
  agents: 'magpie:agents',
  setModel: 'magpie:setModel',
  models: 'magpie:models',
  openManagement: 'magpie:openManagement',
  catalog: 'magpie:catalog',
  selectDefault: 'magpie:selectDefault',
  setSubscriptionAccounts: 'magpie:setSubscriptionAccounts',
} as const;
export interface MagpieStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  version: string;
  gatewayUrl?: string;
  /** Persisted user authorization to run the service, separate from current process state. */
  enabled?: boolean;
  subscriptionAccountsEnabled?: boolean;
  error?: string;
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
export interface MagpieApi {
  status(): Promise<MagpieStatus>;
  start(): Promise<MagpieStatus>;
  stop(): Promise<MagpieStatus>;
  agents(): Promise<MagpieAgents>;
  setModel(selection: MagpieModelSelection): Promise<MagpieAgents>;
  models(): Promise<MagpieModel[]>;
  openManagement(): Promise<void>;
  catalog(): Promise<MagpieModelCatalog>;
  selectDefault(modelId: string): Promise<MagpieModelCatalog>;
  setSubscriptionAccounts(enabled: boolean): Promise<MagpieStatus>;
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
