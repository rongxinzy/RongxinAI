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
    // Recommendations show the curated cloud list without applying a device-fit
    // filter. Fit is displayed on each card and can be selected in all-models mode.
    const params = buildMarketplaceSearchParams({ query, featuredOnly: true, fit: 'all' });
    if (!params) return;
    onHasSearchedChange(true);
    void onSearch(params);
  }, [activeTab, hasSearched, onHasSearchedChange, onSearch, query]);
}
