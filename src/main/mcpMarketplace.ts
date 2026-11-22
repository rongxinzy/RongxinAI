import { realpath } from 'node:fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { readBoundedFile } from './libs/boundedFileRead';
import { isPathInside } from './pathContainment';

interface McpPresentationSection {
  title?: string;
  description?: string;
}

interface McpPresentationLocale {
  description?: string;
  examples?: string[];
  connect?: {
    usage?: McpPresentationSection;
    data?: McpPresentationSection;
    control?: McpPresentationSection;
    authorization?: McpPresentationSection;
  };
}

interface McpPresentation {
  name?: string;
  authorization?: string;
  zh?: McpPresentationLocale;
  en?: McpPresentationLocale;
}

export interface BundledMcpMarketplace {
  categories: Array<{ id: string; name_zh: string; name_en: string }>;
  servers: Array<Record<string, unknown>>;
}

export interface McpMarketplaceAssets {
  catalog: BundledMcpMarketplace;
  icons: Map<string, { data: string } | { error: string }>;
}

const McpMarketplaceLimit = {
  Entries: 64,
  RegistryBytes: 128 * 1024,
  MetadataBytes: 16 * 1024,
  IconBytes: 32 * 1024,
} as const;

const MCP_REGISTRY_FILE_NAME = 'registry.json';

function isMarketplace(value: unknown): value is BundledMcpMarketplace {
  if (!value || typeof value !== 'object') return false;
  const marketplace = value as Partial<BundledMcpMarketplace>;
  return (
    Array.isArray(marketplace.categories) &&
    marketplace.categories.length <= McpMarketplaceLimit.Entries &&
    Array.isArray(marketplace.servers) &&
    marketplace.servers.length <= McpMarketplaceLimit.Entries
  );
}

async function resolveAsset(root: string, relativePath: string): Promise<string | undefined> {
  const candidate = path.resolve(root, relativePath);
  if (!isPathInside(candidate, root) || candidate === root) return undefined;
  try {
    const resolved = await realpath(candidate);
    return isPathInside(resolved, await realpath(root)) ? resolved : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function loadPresentation(
  root: string,
  metadataPath: unknown,
): Promise<McpPresentation | undefined> {
  if (typeof metadataPath !== 'string' || !metadataPath.trim()) return undefined;
  try {
    const metadataFile = await resolveAsset(root, metadataPath);
    if (!metadataFile) return undefined;
    const raw = await readBoundedFile(metadataFile, McpMarketplaceLimit.MetadataBytes);
    const parsed = yaml.load(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const presentation = (parsed as Record<string, unknown>).presentation;
    return presentation && typeof presentation === 'object'
      ? (presentation as McpPresentation)
      : undefined;
  } catch (error) {
    console.warn('[McpMarketplace] failed to read MCP metadata:', metadataPath, error);
    return undefined;
  }
}

const mimeByExtension = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
]);

export async function loadBundledMcpMarketplace(roots: string[]): Promise<McpMarketplaceAssets> {
  for (const root of roots) {
    const filePath = path.join(root, MCP_REGISTRY_FILE_NAME);
    try {
      const raw = await readBoundedFile(filePath, McpMarketplaceLimit.RegistryBytes);
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (isMarketplace(parsed)) {
        const servers: BundledMcpMarketplace['servers'] = [];
        const icons: McpMarketplaceAssets['icons'] = new Map();
        for (const server of parsed.servers) {
          servers.push({
            ...server,
            presentation: await loadPresentation(root, server.metadataPath),
          });
          const iconPath = server.iconPath;
          if (typeof iconPath === 'string' && !icons.has(iconPath)) {
            icons.set(iconPath, await loadIcon(roots, iconPath));
          }
        }
        return { catalog: { ...parsed, servers }, icons };
      }
      console.warn('[McpMarketplace] bundled registry has an invalid shape');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[McpMarketplace] failed to read bundled registry:', error);
      }
    }
  }

  throw new Error('Bundled MCP registry was not found');
}

async function loadIcon(
  roots: string[],
  iconPath: string,
): Promise<{ data: string } | { error: string }> {
  try {
    for (const root of roots) {
      const filePath = await resolveAsset(root, iconPath);
      if (!filePath) continue;
      const mime = mimeByExtension.get(path.extname(iconPath).toLowerCase());
      if (!mime) return { error: 'Unsupported MCP icon format' };
      const bytes = await readBoundedFile(filePath, McpMarketplaceLimit.IconBytes);
      return { data: `data:${mime};base64,${bytes.toString('base64')}` };
    }
    return { error: 'MCP icon was not found' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load MCP icon' };
  }
}
