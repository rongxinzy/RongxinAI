import type { McpCategory, McpRegistryEntry } from '../types/mcp';

import registryBundle from './mcpRegistry.json';

const CATEGORY_ID_TO_I18N_KEY: Record<string, string> = {
  all: 'mcpCategoryAll',
  search: 'mcpCategorySearch',
  developer: 'mcpCategoryDeveloper',
  productivity: 'mcpCategoryProductivity',
  browser: 'mcpCategoryBrowser',
  design: 'mcpCategoryDesign',
  'data-api': 'mcpCategoryDataApi',
};

type BundledRegistry = {
  categories: Array<{ id: string; name_zh: string; name_en: string }>;
  servers: Array<{
    id: string;
    name: string;
    description_zh?: string;
    description_en?: string;
    category: string;
    transportType: 'stdio' | 'sse' | 'http';
    command?: string;
    defaultArgs?: string[];
    url?: string;
    headers?: Record<string, string>;
    authType?: McpRegistryEntry['authType'];
    requiredEnvKeys?: string[];
    optionalEnvKeys?: string[];
    argPlaceholders?: string[];
    connectorPath?: string;
    iconPath?: string;
    metadataPath?: string;
  }>;
};

const bundle = registryBundle as BundledRegistry;

const toRegistryEntry = (server: BundledRegistry['servers'][number]): McpRegistryEntry => ({
  id: server.id,
  name: server.name,
  descriptionKey: '',
  description_zh: server.description_zh,
  description_en: server.description_en,
  category: server.category as McpCategory,
  categoryKey: CATEGORY_ID_TO_I18N_KEY[server.category] ?? 'mcpCategoryDeveloper',
  transportType: server.transportType,
  command: server.command,
  defaultArgs: server.defaultArgs,
  url: server.url,
  headers: server.headers,
  authType: server.authType,
  requiredEnvKeys: server.requiredEnvKeys,
  optionalEnvKeys: server.optionalEnvKeys,
  argPlaceholders: server.argPlaceholders,
  connectorPath: server.connectorPath,
  iconPath: server.iconPath,
  metadataPath: server.metadataPath,
});

/**
 * Fallback entries used only when the bundled marketplace cannot be loaded.
 * Derived from mcpRegistry.json (kept in sync with MCPs/registry.json; guarded by
 * src/main/mcpRegistryIntegrity.test.ts and src/renderer/data/mcpRegistry.test.ts).
 */
export const mcpRegistry: McpRegistryEntry[] = bundle.servers.map(toRegistryEntry);

export const mcpCategories = bundle.categories.map(category => ({
  id: category.id,
  key: CATEGORY_ID_TO_I18N_KEY[category.id] ?? 'mcpCategoryDeveloper',
}));
