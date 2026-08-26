import type { ModelCapabilities, ProviderConfig } from './providers';

export const ManagedProviderAccessMode = {
  Open: 'open',
  Exclusive: 'exclusive',
} as const;
export type ManagedProviderAccessMode =
  (typeof ManagedProviderAccessMode)[keyof typeof ManagedProviderAccessMode];

export interface ManagedProviderAccessPolicy {
  readonly mode: ManagedProviderAccessMode;
  readonly providerKeys: readonly string[];
}

export const OPEN_MANAGED_PROVIDER_ACCESS_POLICY: ManagedProviderAccessPolicy = Object.freeze({
  mode: ManagedProviderAccessMode.Open,
  providerKeys: Object.freeze([]),
});

export interface ManagedProviderSnapshot {
  readonly providerKey: string;
  readonly exclusive: boolean;
  readonly config: ProviderConfig;
}

export interface ManagedProviderCatalogModel {
  readonly id: string;
  readonly displayName: string;
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly contextWindow?: number;
  readonly isDefault: boolean;
}
