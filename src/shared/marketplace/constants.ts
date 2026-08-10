export const MarketplaceIpcChannel = {
  Search: 'marketplace:search',
  CancelSearch: 'marketplace:cancel-search',
} as const;

export const MarketplaceDeviceProfile = {
  Base: 'base',
  Pro: 'pro',
  Other: 'other',
} as const;

export type MarketplaceDeviceProfile =
  (typeof MarketplaceDeviceProfile)[keyof typeof MarketplaceDeviceProfile];
