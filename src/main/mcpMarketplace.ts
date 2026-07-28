import fs from 'fs';
import path from 'path';

export interface BundledMcpMarketplace {
  categories: Array<{ id: string; name_zh: string; name_en: string }>;
  servers: unknown[];
}

const MCP_DIRECTORY_NAME = 'MCPs';
const MCP_REGISTRY_FILE_NAME = 'registry.json';

function isMarketplace(value: unknown): value is BundledMcpMarketplace {
  if (!value || typeof value !== 'object') return false;
  const marketplace = value as Partial<BundledMcpMarketplace>;
  return Array.isArray(marketplace.categories) && Array.isArray(marketplace.servers);
}

export function loadBundledMcpMarketplace(appPath: string, resourcesPath: string): BundledMcpMarketplace {
  const candidates = [
    path.join(resourcesPath, MCP_DIRECTORY_NAME, MCP_REGISTRY_FILE_NAME),
    path.join(appPath, MCP_DIRECTORY_NAME, MCP_REGISTRY_FILE_NAME),
    path.join(process.cwd(), MCP_DIRECTORY_NAME, MCP_REGISTRY_FILE_NAME),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (isMarketplace(parsed)) return parsed;
      console.warn('[McpMarketplace] bundled registry has an invalid shape');
    } catch (error) {
      console.warn('[McpMarketplace] failed to read bundled registry:', error);
    }
  }

  throw new Error('Bundled MCP registry was not found');
}
