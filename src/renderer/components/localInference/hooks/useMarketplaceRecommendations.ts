import { useEffect } from 'react';

import type { MarketplaceSearchParams } from '../../../../shared/marketplace';
import type { LocalInferenceTab } from '../types';
import { buildMarketplaceSearchParams } from '../utils/marketplace';

export function useMarketplaceRecommendations({
  activeTab,
  hasSearched,
  query,
  onHasSearchedChange,
  onSearch,
}: {
  activeTab: LocalInferenceTab;
  hasSearched: boolean;
  query: string;
  onHasSearchedChange: (value: boolean) => void;
  onSearch: (params: MarketplaceSearchParams) => Promise<void>;
}): void {
  useEffect(() => {
    if (activeTab !== 'marketplace' || hasSearched) return;
    // fit: 'compatible' keeps the first paint consistent with the default
    // "可运行" filter shown in the panel — an unrestricted first load would
    // list models the device cannot run while the filter claims otherwise.
    const params = buildMarketplaceSearchParams({ query, featuredOnly: true, fit: 'compatible' });
    if (!params) return;
    onHasSearchedChange(true);
    void onSearch(params);
  }, [activeTab, hasSearched, onHasSearchedChange, onSearch, query]);
}
