/**
 * Marketplace registry, categories and icon URLs for the MCP manager.
 *
 * Extracted verbatim from McpManager.tsx (issue #1069): fetches the remote
 * marketplace once on mount, then loads an icon per registry entry that
 * declares `iconPath`.
 */
import { useEffect, useState } from 'react';

import { mcpCategories, mcpRegistry } from '../../../data/mcpRegistry';
import { mcpService } from '../../../services/mcp';
import type { McpMarketplaceCategoryInfo, McpRegistryEntry } from '../../../types/mcp';

export interface McpDynamicCategory {
  id: string;
  key: string;
  name_zh?: string;
  name_en?: string;
}

export function useMcpMarketplaceData() {
  const [dynamicRegistry, setDynamicRegistry] = useState<McpRegistryEntry[]>(mcpRegistry);
  const [dynamicCategories, setDynamicCategories] =
    useState<ReadonlyArray<McpDynamicCategory>>(mcpCategories);
  const [officialIcons, setOfficialIcons] = useState<Record<string, string>>({});

  useEffect(() => {
    let isActive = true;
    const fetchMarketplace = async () => {
      const result = await mcpService.fetchMarketplace();
      if (!isActive || !result) return;
      setDynamicRegistry(result.registry);
      const cats: Array<{ id: string; key: string; name_zh?: string; name_en?: string }> = [
        { id: 'all', key: 'mcpCategoryAll' },
        ...result.categories
          .filter((c: McpMarketplaceCategoryInfo) => c.id !== 'all')
          .map((c: McpMarketplaceCategoryInfo) => ({
            id: c.id,
            key: '',
            name_zh: c.name_zh,
            name_en: c.name_en,
          })),
      ];
      setDynamicCategories(cats);
    };
    fetchMarketplace();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const loadIcons = async () => {
      const entries = await Promise.all(
        dynamicRegistry
          .filter(entry => entry.iconPath)
          .map(async entry => ({ id: entry.id, icon: await mcpService.loadIcon(entry.iconPath!) })),
      );
      if (!isActive) return;
      setOfficialIcons(
        Object.fromEntries(entries.flatMap(entry => (entry.icon ? [[entry.id, entry.icon]] : []))),
      );
    };
    loadIcons();
    return () => {
      isActive = false;
    };
  }, [dynamicRegistry]);

  return { dynamicRegistry, dynamicCategories, officialIcons };
}
