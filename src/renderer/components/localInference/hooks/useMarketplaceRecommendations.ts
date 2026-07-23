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
    const params = buildMarketplaceSearchParams({ query });
    if (!params) return;
    onHasSearchedChange(true);
    void onSearch(params);
  }, [activeTab, hasSearched, onHasSearchedChange, onSearch, query]);
}
