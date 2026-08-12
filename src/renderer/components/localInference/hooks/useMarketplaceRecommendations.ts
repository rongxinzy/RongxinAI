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
    // Load the complete model catalogue when the marketplace tab opens.
    // The renderer applies the selected fit filter after local hardware scoring.
    const params = buildMarketplaceSearchParams({ query, featuredOnly: false, fit: 'all' });
    if (!params) return;
    onHasSearchedChange(true);
    void onSearch(params);
  }, [activeTab, hasSearched, onHasSearchedChange, onSearch, query]);
}
