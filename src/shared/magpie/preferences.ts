export interface MagpieModelRef {
  id: string;
  name?: string;
  providerName?: string;
  vendorPicks?: boolean;
}

export interface MagpieSearchChoice {
  id: string;
  name: string;
  service?: boolean;
  models: MagpieModelRef[];
}

export interface MagpiePreferences {
  version: string;
  dataDir: string;
  gateway: string;
  publicUrl?: string;
  proxy: string;
  proxyNow: string;
  proxySource: string;
  bareModelIDs: boolean;
  port: number;
  portEnv?: string;
  lan: boolean;
  onNetwork: boolean;
  lanUrls: string[];
  vision: string;
  visionAuto?: string;
  visionMissing?: string;
  visionEffort: string;
  visionEfforts: string[];
  visionModels: MagpieModelRef[];
  imageGen: string;
  imageGenAuto?: string;
  imageGenMissing?: string;
  imageGenShown?: string;
  imageGenModels: MagpieModelRef[];
  searcher: string;
  searcherEffort: string;
  searchFirst: string;
  searchAuto?: string;
  searchUnused?: string;
  searchEfforts: string[];
  searchChoices: MagpieSearchChoice[];
  searchProvider?: string;
  searchRelays: string[];
  disabledModels: string[];
  redact: boolean;
  redactPersonal: boolean;
  redactKinds: Record<string, boolean>;
  redactWords: string[];
  noAccountDiscovery: boolean;
  noAccountsEnv: boolean;
}

/**
 * The subset of upstream preferences the host can safely change from the
 * application renderer. Network topology, credentials and per-agent model
 * maps stay host-owned.
 */
export interface MagpiePreferencesPatch {
  proxy?: string;
  bareModelIDs?: boolean;
  vision?: string;
  visionEffort?: string;
  imageGen?: string;
  searcher?: string;
  searcherEffort?: string;
  searchFirst?: string;
  disabledModels?: string[];
  redact?: boolean;
  redactPersonal?: boolean;
  redactKinds?: Record<string, boolean>;
  redactWords?: string[];
}

export const MAGPIE_PREFERENCE_PATCH_KEYS = [
  'proxy',
  'bareModelIDs',
  'vision',
  'visionEffort',
  'imageGen',
  'searcher',
  'searcherEffort',
  'searchFirst',
  'disabledModels',
  'redact',
  'redactPersonal',
  'redactKinds',
  'redactWords',
] as const;

/** Upstream redact.Categories: ids are stable, labels live in the renderer. */
export const MAGPIE_REDACT_KINDS = [
  { id: 'ssn', defaultOn: true },
  { id: 'passport', defaultOn: true },
  { id: 'iban', defaultOn: true },
  { id: 'birthday', defaultOn: true },
  { id: 'mac', defaultOn: true },
  { id: 'serial', defaultOn: true },
  { id: 'home', defaultOn: false },
  { id: 'userhost', defaultOn: false },
  { id: 'ip', defaultOn: false },
  { id: 'bucket', defaultOn: false },
] as const;
