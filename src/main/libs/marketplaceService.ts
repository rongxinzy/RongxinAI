import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import {
  MarketplaceCapability,
  type MarketplaceModel,
  type MarketplaceSearchParams,
  type MarketplaceSearchResult,
} from '../../shared/marketplace';
import { resolveMarketplaceParameterCount } from './marketplaceModelOrder';
import { ModelCatalogClient, type CatalogFetchLike, resolveModelCatalogUrl } from './modelCatalogClient';

type MarketplaceServiceOptions = {
  catalogApiUrl?: string | null;
  fetchImpl?: CatalogFetchLike;
  // Optional directory for a disk cache of catalogue responses. The catalogue
  // changes rarely, so a stale copy still beats a failed round-trip — it keeps
  // first paint and pagination instant and shields the user from upstream
  // outages. When absent, caching is disabled.
  cacheDir?: string;
};

// Model catalogue data changes rarely; keep copies fresh long enough that
// repeated visits never hit the network, and treat expired copies as
// last-resort fallbacks when the catalogue is unreachable.
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_FILES = 300;

type InstalledModelRecord = {
  repoId: string;
  installedPath: string;
};

const DEFAULT_LIMIT = 20;
const SEARCH_CACHE_VERSION = 'v4';
const CATALOG_ERROR_PREFIX = 'CATALOG_ERROR:';
const NON_GENERATIVE_GGUF_PATTERN =
  /\b(?:embedding|embed|bge(?:[-_]|\b)|e5(?:[-_]|\b)|gte(?:[-_]|\b)|rerank(?:er)?|sentence[-_ ]transformers?|clip|siglip|colbert|vector(?:izer)?|text[-_ ]embedding)\b/i;

/**
 * Desktop catalogue adapter.
 *
 * Network metadata is accepted only from the Cloudflare catalogue. The desktop
 * never sends a ModelScope credential and never falls back to the ModelScope
 * API directly. Offline resilience comes from the on-disk cache of catalogue
 * responses; there is no bundled browse-only fallback.
 */
export class MarketplaceService {
  private readonly cache: MarketplaceDiskCache | null;

  constructor(
    private readonly getModelsDir: () => string = () => '',
    private readonly options: MarketplaceServiceOptions = {},
  ) {
    this.cache = options.cacheDir?.trim()
      ? new MarketplaceDiskCache(options.cacheDir.trim())
      : null;
  }

  async search(
    params: MarketplaceSearchParams = {},
    signal?: AbortSignal,
  ): Promise<MarketplaceSearchResult> {
    const catalogUrl = this.resolveCatalogUrl();
    if (!catalogUrl) {
      return {
        models: [],
        totalCount: 0,
        warning: `${CATALOG_ERROR_PREFIX}云端模型目录未配置。`,
        source: 'cloud-catalog',
      };
    }

    try {
      if (signal?.aborted) throw signal.reason;
      const client = new ModelCatalogClient(catalogUrl, this.options.fetchImpl);
      const searchParams = { ...params };
      const cacheKey = searchCacheKey(searchParams);
      const cached = this.cache?.read<MarketplaceSearchResult>(cacheKey);
      if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
        const models = this.processCatalog(cached.response, searchParams);
        return { ...cached.response, models, totalCount: cached.response.totalCount ?? models.length };
      }
      let catalog: MarketplaceSearchResult;
      try {
        catalog = await this.fetchCatalog(client, searchParams, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (cached) {
          console.warn('[Marketplace] catalogue unreachable; serving cached search:', error);
          const models = this.processCatalog(cached.response, searchParams);
          return {
            ...cached.response,
            models,
            totalCount: cached.response.totalCount ?? models.length,
            warning: '云端 GGUF 目录暂时不可用，正在展示最近一次缓存的目录。',
          };
        }
        throw error;
      }
      this.cache?.write(cacheKey, catalog);
      const models = this.processCatalog(catalog, searchParams);
      return { ...catalog, models, totalCount: catalog.totalCount ?? models.length };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[Marketplace] cloud catalogue unavailable:', error);
      return {
        models: [],
        totalCount: 0,
        warning: `${CATALOG_ERROR_PREFIX}${toMarketplaceWarning(error)}`,
        source: 'cloud-catalog',
      };
    }
  }

  private processCatalog(
    catalog: MarketplaceSearchResult,
    params: MarketplaceSearchParams,
  ): MarketplaceModel[] {
    const installed = scanInstalledModels(this.getModelsDir());
    const models = params.fit === 'all'
      ? catalog.models
      : filterMarketplaceModels(catalog.models, { ...params, fit: undefined });
    // The catalogue owns the global order and cursor boundary. Local metadata
    // annotation must preserve that order for every page.
    return annotateInstalledModels(models, installed);
  }

  private async fetchCatalog(
    client: ModelCatalogClient,
    params: MarketplaceSearchParams,
    signal?: AbortSignal,
  ): Promise<MarketplaceSearchResult> {
    return client.search(
      {
        ...params,
        limit: params.limit ?? DEFAULT_LIMIT,
      },
      signal,
    );
  }


  async resolveModel(repoId: string): Promise<MarketplaceModel | null> {
    const normalizedRepoId = repoId.trim();
    if (!normalizedRepoId) return null;

    const catalogUrl = this.resolveCatalogUrl();
    if (catalogUrl) {
      const client = new ModelCatalogClient(catalogUrl, this.options.fetchImpl);
      const cacheKey = `detail:${normalizedRepoId}`;
      const cached = this.cache?.read<MarketplaceModel>(cacheKey);
      if (cached && Date.now() - cached.cachedAt < DETAIL_CACHE_TTL_MS) {
        const model = cached.response;
        if (model && isGenerativeLanguageModel(model)) return model;
      }
      try {
        const model = await client.resolveModel(normalizedRepoId);
        if (model && isGenerativeLanguageModel(model)) {
          this.cache?.write(cacheKey, model);
          return model;
        }
      } catch (error) {
        console.warn('[Marketplace] verified catalogue detail unavailable:', error);
        if (cached) {
          const model = cached.response;
          if (model && isGenerativeLanguageModel(model)) return model;
        }
      }
    }

    return null;
  }

  private resolveCatalogUrl(): string | null {
    return this.options.catalogApiUrl === undefined
      ? resolveModelCatalogUrl()
      : this.options.catalogApiUrl;
  }
}

function annotateInstalledModels(
  models: MarketplaceModel[],
  installed: Map<string, InstalledModelRecord>,
): MarketplaceModel[] {
  return models.map(model => {
    const match = installed.get(model.repoId);
    return {
      ...model,
      installed: Boolean(match),
      installedPath: match?.installedPath,
    };
  });
}

function scanInstalledModels(modelsDir: string): Map<string, InstalledModelRecord> {
  const normalizedRoot = modelsDir.trim();
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) return new Map();
  const modelscopeRoot = path.join(normalizedRoot, 'modelscope');
  if (!fs.existsSync(modelscopeRoot)) return new Map();

  const installed = new Map<string, InstalledModelRecord>();
  for (const filePath of walkFiles(modelscopeRoot)) {
    if (!filePath.toLowerCase().endsWith('.gguf') || /[/\\]mmproj/i.test(filePath)) continue;
    const [owner, repo] = path.relative(modelscopeRoot, filePath).split(path.sep);
    if (!owner || !repo) continue;
    const repoId = `${owner}/${repo}`;
    if (!installed.has(repoId)) installed.set(repoId, { repoId, installedPath: filePath });
  }
  return installed;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of safeReadDir(dir)) {
    const candidate = path.join(dir, entry);
    files.push(...(safeIsDirectory(candidate) ? walkFiles(candidate) : [candidate]));
  }
  return files;
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeIsDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function filterMarketplaceModels(
  models: MarketplaceModel[],
  params: MarketplaceSearchParams,
): MarketplaceModel[] {
  const requiredTags = new Set(
    [...(params.tags ?? []), ...tagsForTask(params.task)].map(tag => tag.toLowerCase()),
  );
  return models
    .filter(isGenerativeLanguageModel)
    .filter(model => !params.source || params.source === 'all' || params.source === model.source)
    .filter(model => !params.featuredOnly || Boolean(model.isFeatured))
    .filter(model => matchesQuery(model, params.query))
    .filter(model => matchesTags(model, requiredTags))
    .filter(model => matchesSizeFilter(model, params.size))
    .filter(model => !params.minStars || (model.score?.stars ?? 0) >= params.minStars);
}

function isGenerativeLanguageModel(model: MarketplaceModel): boolean {
  return !NON_GENERATIVE_GGUF_PATTERN.test(
    [model.repoId, model.name, model.description, ...model.tags].join(' '),
  );
}

function matchesQuery(model: MarketplaceModel, query?: string): boolean {
  if (!query?.trim()) return true;
  const normalized = query.trim().toLowerCase();
  const haystacks = [
    model.repoId,
    model.id,
    model.name,
    model.description,
    model.tags.join(' '),
    model.sizes.join(' '),
    model.recommendedTag,
  ].filter((value): value is string => typeof value === 'string');
  return haystacks.some(value => value.toLowerCase().includes(normalized));
}

function matchesTags(model: MarketplaceModel, required: Set<string>): boolean {
  if (required.size === 0) return true;
  const available = new Set(
    [...model.tags, ...(model.capabilities ?? [model.capability])].map(tag => tag.toLowerCase()),
  );
  return [...required].every(tag => available.has(tag));
}

function matchesSizeFilter(
  model: MarketplaceModel,
  size?: MarketplaceSearchParams['size'],
): boolean {
  if (!size || size === 'all') return true;
  const count = resolveMarketplaceParameterCount(model);
  if (count === null) return true;
  const billions = count;
  if (size === 'small') return billions < 4;
  if (size === 'desktop') return billions >= 4 && billions <= 8;
  if (size === 'workstation') return billions > 8 && billions <= 32;
  return size !== 'large' || billions > 32;
}

function tagsForTask(task?: MarketplaceSearchParams['task']): MarketplaceCapability[] {
  return task && task !== 'all' ? [task] : [];
}


function toMarketplaceWarning(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type CachedMarketplaceEntry<T> = {
  cachedAt: number;
  response: T;
};

class MarketplaceDiskCache {
  constructor(private readonly dir: string) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Cache is best-effort; a read-only data dir must not break the service.
    }
  }

  read<T>(key: string): CachedMarketplaceEntry<T> | null {
    try {
      const raw = fs.readFileSync(this.fileFor(key), 'utf8');
      const parsed = JSON.parse(raw) as CachedMarketplaceEntry<T>;
      if (!parsed || typeof parsed.cachedAt !== 'number' || !parsed.response) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  write<T>(key: string, response: T): void {
    try {
      const entry: CachedMarketplaceEntry<T> = { cachedAt: Date.now(), response };
      const filePath = this.fileFor(key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
      this.prune();
    } catch (error) {
      console.warn('[Marketplace] cache write failed:', error);
    }
  }

  private fileFor(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return path.join(this.dir, `${digest}.json`);
  }

  private prune(): void {
    try {
      const entries = fs
        .readdirSync(this.dir)
        .filter(name => name.endsWith('.json'))
        .map(name => {
          const filePath = path.join(this.dir, name);
          return { filePath, mtime: fs.statSync(filePath).mtimeMs };
        })
        .sort((left, right) => left.mtime - right.mtime);
      if (entries.length <= CACHE_MAX_FILES) return;
      for (const entry of entries.slice(0, entries.length - CACHE_MAX_FILES)) {
        fs.rmSync(entry.filePath, { force: true });
      }
    } catch {
      // Pruning is best-effort.
    }
  }
}

function searchCacheKey(params: MarketplaceSearchParams): string {
  const parts = [
    SEARCH_CACHE_VERSION,
    params.query?.trim().toLowerCase() ?? '',
    params.task ?? '',
    params.size ?? '',
    (params.tags ?? []).slice().sort().join(','),
    params.limit ?? '',
    params.pageNumber ?? '',
    params.cursor ?? '',
    params.device ?? '',
    params.featuredOnly ? 'featured' : '',
    params.fit ?? '',
  ];
  return `search:${parts.join('|')}`;
}
