// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { MARKETPLACE_PAGE_SIZE } from '../constants';
import type { LocalInferenceTab } from '../types';
import { useMarketplaceRecommendations } from './useMarketplaceRecommendations';

const tab: LocalInferenceTab = 'marketplace';

describe('useMarketplaceRecommendations', () => {
  test('loads featured recommendations once when the marketplace tab opens', () => {
    const onSearch = vi.fn().mockResolvedValue(undefined);
    const onHasSearchedChange = vi.fn();
    const { rerender } = renderHook(
      ({ hasSearched }) =>
        useMarketplaceRecommendations({
          activeTab: tab,
          hasSearched,
          query: '',
          onHasSearchedChange,
          onSearch,
        }),
      { initialProps: { hasSearched: false } },
    );

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ featuredOnly: true, fit: 'recommended', limit: MARKETPLACE_PAGE_SIZE }),
    );
    expect(onHasSearchedChange).toHaveBeenCalledWith(true);

    // Once the parent reports a search happened, the hook stays quiet.
    rerender({ hasSearched: true });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  test('does not fire while another tab is active', () => {
    const onSearch = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useMarketplaceRecommendations({
        activeTab: 'models',
        hasSearched: false,
        query: '',
        onHasSearchedChange: vi.fn(),
        onSearch,
      }),
    );
    expect(onSearch).not.toHaveBeenCalled();
  });
});
