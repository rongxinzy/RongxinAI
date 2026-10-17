import { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import { skillService } from '../../../services/skill';
import { MarketplaceSkill } from '../../../types/skill';
import { SKILL_PAGE_SIZE, SkillTab } from '../constants';

interface UseMarketplaceCatalogOptions {
  activeTab: SkillTab;
  setSkillActionError: (message: string) => void;
}

/**
 * Marketplace listing state: the first page, pagination cursor, loading
 * flags and the lazy first-load effect for the marketplace tab. Errors are
 * reported through the caller's shared skill action error state.
 */
export function useMarketplaceCatalog({
  activeTab,
  setSkillActionError,
}: UseMarketplaceCatalogOptions) {
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketplacePageNumber, setMarketplacePageNumber] = useState(1);
  const [marketplaceHasMore, setMarketplaceHasMore] = useState(true);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);
  const [isLoadingMoreMarketplace, setIsLoadingMoreMarketplace] = useState(false);
  const marketplaceLoadedRef = useRef(false);

  const refreshMarketplace = useCallback(async (forceRefresh = false) => {
    setIsLoadingMarketplace(true);
    try {
      const page = await skillService.fetchMarketplaceSkills({
        forceRefresh,
        pageNumber: 1,
        pageSize: SKILL_PAGE_SIZE,
      });
      setMarketplaceSkills(page.skills);
      setMarketplacePageNumber(1);
      setMarketplaceHasMore(page.hasMore);
      setSkillActionError('');
      return page.skills;
    } catch (error) {
      setSkillActionError(
        error instanceof Error ? error.message : i18nService.t('skillMarketplaceLoadFailed'),
      );
      throw error;
    } finally {
      setIsLoadingMarketplace(false);
    }
  }, []);

  const loadMarketplacePage = useCallback(
    async (pageNumber: number) => {
      if (
        pageNumber < 1 ||
        isLoadingMarketplace ||
        isLoadingMoreMarketplace ||
        (pageNumber > marketplacePageNumber && !marketplaceHasMore)
      ) {
        return;
      }

      setIsLoadingMoreMarketplace(true);
      try {
        const page = await skillService.fetchMarketplaceSkills({
          pageNumber,
          pageSize: SKILL_PAGE_SIZE,
        });
        setMarketplaceSkills(page.skills);
        setMarketplacePageNumber(pageNumber);
        setMarketplaceHasMore(page.hasMore);
      } catch (error) {
        setSkillActionError(
          error instanceof Error ? error.message : i18nService.t('skillMarketplaceLoadFailed'),
        );
      } finally {
        setIsLoadingMoreMarketplace(false);
      }
    },
    [isLoadingMarketplace, isLoadingMoreMarketplace, marketplaceHasMore, marketplacePageNumber],
  );

  useEffect(() => {
    if (activeTab !== SkillTab.Marketplace || marketplaceLoadedRef.current) return;
    marketplaceLoadedRef.current = true;
    refreshMarketplace(false).catch(() => {
      marketplaceLoadedRef.current = false;
    });
  }, [activeTab, refreshMarketplace]);

  return {
    marketplaceSkills,
    marketplacePageNumber,
    marketplaceHasMore,
    isLoadingMarketplace,
    isLoadingMoreMarketplace,
    loadMarketplacePage,
  };
}
