import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface McpPresentationSection {
  title?: string;
  description?: string;
}

export interface McpPresentationLocale {
  description?: string;
  connect?: {
    usage?: McpPresentationSection;
    data?: McpPresentationSection;
    control?: McpPresentationSection;
    authorization?: McpPresentationSection;
  };
}

export interface McpPresentation {
  name?: string;
  authorization?: string;
  zh?: McpPresentationLocale;
  en?: McpPresentationLocale;
}

export interface BundledMcpMarketplace {
  categories: Array<{ id: string; name_zh: string; name_en: string }>;
  servers: Array<Record<string, unknown>>;
}

const MCP_DIRECTORY_NAME = 'MCPs';
const MCP_REGISTRY_FILE_NAME = 'registry.json';

function isMarketplace(value: unknown): value is BundledMcpMarketplace {
  if (!value || typeof value !== 'object') return false;
  const marketplace = value as Partial<BundledMcpMarketplace>;
  return Array.isArray(marketplace.categories) && Array.isArray(marketplace.servers);
}

function loadPresentation(root: string, metadataPath: unknown): McpPresentation | undefined {
  if (typeof metadataPath !== 'string' || !metadataPath.trim()) return undefined;
  const resolvedRoot = path.resolve(root);
  const metadataFile = path.resolve(resolvedRoot, metadataPath);
  if (!metadataFile.startsWith(`${resolvedRoot}${path.sep}`) || !fs.existsSync(metadataFile)) {
    return undefined;
  }
  try {
    const parsed = yaml.load(fs.readFileSync(metadataFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const presentation = (parsed as Record<string, unknown>).presentation;
    return presentation && typeof presentation === 'object'
      ? (presentation as McpPresentation)
      : undefined;
  } catch (error) {
    console.warn('[McpMarketplace] failed to read MCP metadata:', metadataFile, error);
    return undefined;
  }
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
      if (isMarketplace(parsed)) {
        const registryRoot = path.dirname(filePath);
        return {
          ...parsed,
          servers: parsed.servers.map(server => ({
            ...server,
            presentation: loadPresentation(registryRoot, server.metadataPath),
          })),
        };
      }
      console.warn('[McpMarketplace] bundled registry has an invalid shape');
    } catch (error) {
      console.warn('[McpMarketplace] failed to read bundled registry:', error);
    }
  }

  throw new Error('Bundled MCP registry was not found');
}
