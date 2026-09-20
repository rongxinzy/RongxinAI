import type { ModelCapabilities } from './providers';

export const AISphere = {
  Provider: 'custom_aisphere',
  StoreKey: 'aisphere_binding',
  AppConfigKey: 'app_config',
  VerifyPath: '/v1/agent/is_aisphere',
  ModelsPath: '/v1/agent/models',
  ChatPath: '/v1/chat/completions',
} as const;

export const AISphereIpc = {
  Snapshot: 'aisphere:snapshot',
  Connect: 'aisphere:connect',
  Refresh: 'aisphere:refresh',
} as const;

export const AISphereStatus = {
  Unconfigured: 'unconfigured',
  Ready: 'ready',
  Unavailable: 'unavailable',
} as const;
export type AISphereStatus = (typeof AISphereStatus)[keyof typeof AISphereStatus];

export interface AISphereModel {
  id: string;
  name: string;
  capabilities: Partial<ModelCapabilities>;
  contextWindow?: number;
  maxInput?: number;
  maxTokens?: number;
}

export interface AISphereSnapshot {
  address: string;
  status: AISphereStatus;
  models: AISphereModel[];
}

export const AISphereError = {
  InvalidAddress: 'aisphereInvalidAddress',
  InvalidPlatform: 'aisphereInvalidPlatform',
  InvalidModels: 'aisphereInvalidModels',
  Unavailable: 'aisphereUnavailable',
  MissingModel: 'aisphereMissingModel',
  Busy: 'aisphereBusy',
  RequestRejected: 'aisphereRequestRejected',
} as const;
