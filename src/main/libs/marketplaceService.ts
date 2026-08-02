import fs from 'fs';
import path from 'path';

import {
  MarketplaceCapability,
  type MarketplaceModel,
  type MarketplaceSearchParams,
  type MarketplaceSearchResult,
} from '../../shared/marketplace';
import curatedModels from '../resources/modelscope-gguf-curated-models.json';
import {
  resolveMarketplaceParameterCount,
  resolveParameterCount,
  sortMarketplaceModels,
} from './marketplaceModelOrder';
import { ModelCatalogClient, type CatalogFetchLike, resolveModelCatalogUrl } from './modelCatalogClient';

type MarketplaceServiceOptions = {
  catalogApiUrl?: string | null;
  fetchImpl?: CatalogFetchLike;
};

type CuratedModelEntry = {
  name: string;
  description: string;
  tags: string[];
  sizes: string[];
  recommendedTag: string;
  filePath?: string;
  downloads?: number;
  detailUrl?: string;
  parameterCount?: number;
  featuredRank?: number;
};

type InstalledModelRecord = {
  repoId: string;
  installedPath: string;
};

const MARKETPLACE_SOURCE = 'modelscope-gguf' as const;
const DEFAULT_LIMIT = 120;
const LOCAL_LIMIT = 100;
const CATALOG_ERROR_PREFIX = 'CATALOG_ERROR:';
const NON_GENERATIVE_GGUF_PATTERN =
  /\b(?:embedding|embed|bge(?:[-_]|\b)|e5(?:[-_]|\b)|gte(?:[-_]|\b)|rerank(?:er)?|sentence[-_ ]transformers?|clip|siglip|colbert|vector(?:izer)?|text[-_ ]embedding)\b/i;

/**
 * Desktop catalogue adapter.
 *
 * Network metadata is accepted only from the Cloudflare catalogue. The desktop never sends a
 * ModelScope credential and never falls back to the ModelScope API directly. Bundled entries are
 * browse-only fallback records and cannot be installed until the catalogue supplies a verified
 * file revision, byte size and SHA-256 digest.
 */
export class MarketplaceService {
  constructor(
    private readonly getModelsDir: () => string = () => '',
    private readonly options: MarketplaceServiceOptions = {},
  ) {}

  async search(params: MarketplaceSearchParams = {}): Promise<MarketplaceSearchResult> {
    const catalogUrl = this.resolveCatalogUrl();
    if (!catalogUrl) {
      const models = this.searchLocal(params);
      return { models, totalCount: models.length, source: 'curated' };
    }

    try {
      const catalog = await new ModelCatalogClient(
        catalogUrl,
        this.options.fetchImpl,
      ).search(params);
      const installed = scanInstalledModels(this.getModelsDir());
      const models = sortMarketplaceModels(
        annotateInstalledModels(
          filterMarketplaceModels(catalog.models, { ...params, fit: undefined }),
          installed,
        ),
        params,
      ).slice(0, resolveLimit(params.limit, DEFAULT_LIMIT));
      return { ...catalog, models, totalCount: catalog.totalCount ?? models.length };
    } catch (error) {
      console.warn('[Marketplace] cloud catalogue unavailable; using bundled records:', error);
      const models = this.searchLocal(params);
      return {
        models,
        totalCount: models.length,
        warning: `${CATALOG_ERROR_PREFIX}${toMarketplaceWarning(error)}`,
        source: 'curated',
      };
    }
  }

  searchLocal(params: MarketplaceSearchParams = {}): MarketplaceModel[] {
    const installed = scanInstalledModels(this.getModelsDir());
    const models = (curatedModels as CuratedModelEntry[])
      .map(entry => toMarketplaceModel(entry))
      .filter(isGenerativeLanguageModel);
    return sortMarketplaceModels(
      annotateInstalledModels(filterMarketplaceModels(models, params), installed),
      params,
    ).slice(0, resolveLimit(params.limit, LOCAL_LIMIT));
  }

  async resolveModel(repoId: string): Promise<MarketplaceModel | null> {
    const normalizedRepoId = repoId.trim();
    if (!normalizedRepoId) return null;

    const catalogUrl = this.resolveCatalogUrl();
    if (catalogUrl) {
      try {
        const model = await new ModelCatalogClient(
          catalogUrl,
          this.options.fetchImpl,
        ).resolveModel(normalizedRepoId);
        if (model && isGenerativeLanguageModel(model)) return model;
      } catch (error) {
        console.warn('[Marketplace] verified catalogue detail unavailable:', error);
      }
    }

    return (
      this.searchLocal({ query: normalizedRepoId, limit: LOCAL_LIMIT }).find(
        model => model.repoId === normalizedRepoId,
      ) ?? null
    );
  }

  private resolveCatalogUrl(): string | null {
    return this.options.catalogApiUrl === undefined
      ? resolveModelCatalogUrl()
      : this.options.catalogApiUrl;
  }
}

function toMarketplaceModel(entry: CuratedModelEntry): MarketplaceModel {
  const repoId = entry.name.trim();
  const capabilities = classifyCapabilities(repoId, entry.description, entry.tags);
  return {
    source: MARKETPLACE_SOURCE,
    id: repoId,
    repoId,
    name: repoId,
    description: entry.description,
    tags: unique([...entry.tags, ...capabilities]),
    sizes: entry.sizes,
    recommendedTag: entry.recommendedTag,
    capability: resolvePrimaryCapability(capabilities),
    capabilities,
    filePath: entry.filePath,
    downloads: entry.downloads,
    detailUrl: entry.detailUrl ?? `https://www.modelscope.cn/models/${repoId}`,
    parameterCount: entry.parameterCount ?? resolveParameterCount(entry.sizes),
    installed: false,
    isFeatured: true,
    featuredRank: entry.featuredRank,
    metadataStatus: 'pending',
  };
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
  return [
    model.repoId,
    model.name,
    model.description,
    model.tags.join(' '),
    model.sizes.join(' '),
    model.recommendedTag,
  ].some(value => value.toLowerCase().includes(normalized));
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
  const billions = count / 1_000_000_000;
  if (size === 'small') return billions < 4;
  if (size === 'desktop') return billions >= 4 && billions <= 8;
  if (size === 'workstation') return billions > 8 && billions <= 32;
  return size !== 'large' || billions > 32;
}

function classifyCapabilities(name: string, description: string, tags: string[]): MarketplaceCapability[] {
  const source = `${name} ${description} ${tags.join(' ')}`.toLowerCase();
  const capabilities = new Set<MarketplaceCapability>();
  if (/\b(reasoning|thinking|reasoner|math|stem|qwq|r1)\b/.test(source))
    capabilities.add(MarketplaceCapability.Reasoning);
  if (/\b(code|coder|coding|programming|developer|swe|devstral)\b/.test(source))
    capabilities.add(MarketplaceCapability.Code);
  if (/\b(vision|visual|vl|multimodal|ocr|image)\b/.test(source))
    capabilities.add(MarketplaceCapability.Vision);
  if (/\b(chat|instruct|assistant|conversation|dialogue)\b/.test(source) || capabilities.size === 0)
    capabilities.add(MarketplaceCapability.Chat);
  return [...capabilities];
}

function resolvePrimaryCapability(capabilities: MarketplaceCapability[]): MarketplaceCapability {
  const priority = [
    MarketplaceCapability.Reasoning,
    MarketplaceCapability.Code,
    MarketplaceCapability.Vision,
    MarketplaceCapability.Chat,
  ];
  return priority.find(capability => capabilities.includes(capability)) ?? MarketplaceCapability.Chat;
}

function tagsForTask(task?: MarketplaceSearchParams['task']): MarketplaceCapability[] {
  return task && task !== 'all' ? [task] : [];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function resolveLimit(limit: number | undefined, fallback: number): number {
  return limit && limit > 0 ? limit : fallback;
}

function toMarketplaceWarning(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
