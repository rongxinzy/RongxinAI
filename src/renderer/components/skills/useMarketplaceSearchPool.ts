import { useEffect, useRef, useState } from 'react';

import { skillService } from '../../services/skill';
import type { MarketplaceSkill } from '../../types/skill';
import { SKILL_PAGE_SIZE, SkillTab } from './constants';
import type { SkillTab as SkillTabType } from './constants';

/**
 * The marketplace listing is paged server side. Searching only the loaded page
 * hides every match that lives on a later page, so a query loads one bounded
 * window of pages and searches that window instead.
 */
const MARKETPLACE_SEARCH_MAX_PAGES = 5;

export function useMarketplaceSearchPool(
  activeTab: SkillTabType,
  searchQuery: string,
): { searchPool: MarketplaceSkill[] | null; isLoadingSearchPool: boolean } {
  const [searchPool, setSearchPool] = useState<MarketplaceSkill[] | null>(null);
  const [isLoadingSearchPool, setIsLoadingSearchPool] = useState(false);
  const loadInFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  // Re-arm on every mount: StrictMode runs the cleanup once during the
  // development double-invoke, and a one-way flag would stay false forever.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (activeTab !== SkillTab.Marketplace || !query || searchPool || loadInFlightRef.current) {
      return;
    }

    loadInFlightRef.current = true;
    setIsLoadingSearchPool(true);

    void (async () => {
      try {
        const collected: MarketplaceSkill[] = [];
        for (let page = 1; page <= MARKETPLACE_SEARCH_MAX_PAGES; page += 1) {
          const result = await skillService.fetchMarketplaceSkills({
            pageNumber: page,
            pageSize: SKILL_PAGE_SIZE,
          });
          collected.push(...result.skills);
          if (!result.hasMore) break;
        }
        if (isMountedRef.current) setSearchPool(collected);
      } catch {
        // Fall back to the loaded page: a failed search must never block browsing.
        if (isMountedRef.current) setSearchPool([]);
      } finally {
        loadInFlightRef.current = false;
        if (isMountedRef.current) setIsLoadingSearchPool(false);
      }
    })();
  }, [activeTab, searchQuery, searchPool]);

  return { searchPool, isLoadingSearchPool };
}
