import fs from 'fs';
import path from 'path';

import {
  MarketplaceCapability,
  type MarketplaceModel,
  type MarketplaceSearchParams,
  type MarketplaceSearchResult,
} from '../../shared/marketplace';
import curatedModels from '../resources/modelscope-gguf-curated-models.json';

type MarketplaceServiceOptions = {
  getModelScopeToken?: () => string | null;
};

type OnlineSearchResult = {
  models: MarketplaceModel[];
  totalCount?: number;
  nextPageNumber?: number;
  reachedLimit?: boolean;
  warning?: string;
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
};

type MarketplaceIndexRecord = {
  repoId: string;
  downloads?: number;
  detailUrl?: string;
  description?: string;
  filePath?: string;
  tags?: string[];
  sizes?: string[];
  parameterCount?: number;
};

type ModelScopeOpenApiPage = {
  records: MarketplaceIndexRecord[];
  totalCount?: number;
};

type InstalledModelRecord = {
  repoId: string;
  installedPath: string;
};

const MARKETPLACE_SOURCE = 'modelscope-gguf' as const;
const DEFAULT_LIMIT = 120;
const LOCAL_LIMIT = 100;
const MARKETPLACE_TIMEOUT_MS = 8000;
const MODEL_SCOPE_OPENAPI_RATE_LIMIT_RETRIES = 2;
const MODEL_SCOPE_OPENAPI_PAGE_RETRY_COUNT = 2;
const MODEL_SCOPE_OPENAPI_PAGE_SIZE = 50;
const MODEL_SCOPE_OPENAPI_MAX_PAGE_COUNT = 60;
const MODEL_SCOPE_OPENAPI_MODELS_URL = 'https://modelscope.cn/openapi/v1/models';
const MODEL_SCOPE_SEARCH_API_URL = 'https://www.modelscope.cn/api/v1/models';

export class MarketplaceService {
  constructor(
    private readonly getModelsDir: () => string = () => '',
    private readonly options: MarketplaceServiceOptions = {},
  ) {}

  setTokenGetter(getToken: () => string | null): void {
    this.options.getModelScopeToken = getToken;
  }

  async search(params: MarketplaceSearchParams = {}): Promise<MarketplaceSearchResult> {
    try {
      const online = await this.searchOnline(params);
      const models = sortMarketplaceModels(
        annotateInstalledModels(online.models, scanInstalledModels(this.getModelsDir())),
        params,
      ).slice(0, resolveLimit(params.limit, DEFAULT_LIMIT));
      return {
        models,
        totalCount: models.length,
        nextPageNumber: online.nextPageNumber,
        warning: online.warning,
      };
    } catch (error) {
      return {
        models: this.searchLocal({ ...params, limit: resolveLimit(params.limit, DEFAULT_LIMIT) }),
        warning: toMarketplaceWarning(error),
      };
    }
  }

  searchLocal(params: MarketplaceSearchParams = {}): MarketplaceModel[] {
    const installed = scanInstalledModels(this.getModelsDir());
    const localModels = (curatedModels as CuratedModelEntry[]).map((entry) =>
      toMarketplaceModel(entry, { isFeatured: true }),
    );
    return sortMarketplaceModels(
      annotateInstalledModels(filterMarketplaceModels(localModels, params), installed),
      params,
    ).slice(0, resolveLimit(params.limit, LOCAL_LIMIT));
  }

  private async searchOnline(params: MarketplaceSearchParams): Promise<OnlineSearchResult> {
    const installed = scanInstalledModels(this.getModelsDir());
    let openApiWarning: string | undefined;
    const openApiResults = await this.fetchModelScopeOpenApi(params).catch(
      (error): OnlineSearchResult | undefined => {
        openApiWarning = toMarketplaceWarning(error);
        return undefined;
      },
    );
    if (openApiResults) {
      return {
        ...openApiResults,
        models: annotateInstalledModels(filterMarketplaceModels(openApiResults.models, { ...params, query: undefined }), installed),
      };
    }

    const searchResults = await this.fetchModelScopeSearchApi(params).catch(
      (): MarketplaceModel[] | null => null,
    );
    if (searchResults && searchResults.length > 0) {
      return {
        models: annotateInstalledModels(filterMarketplaceModels(searchResults, params), installed),
        totalCount: searchResults.length,
        warning: openApiWarning,
      };
    }

    const libraryResults = await this.fetchModelScopeLibrary(params).catch((error): MarketplaceModel[] => {
      if (openApiWarning) {
        throw new Error(openApiWarning);
      }
      throw error;
    });
    return {
      models: annotateInstalledModels(filterMarketplaceModels(libraryResults, params), installed),
      totalCount: libraryResults.length,
      warning: openApiWarning,
    };
  }

  private async fetchModelScopeOpenApi(params: MarketplaceSearchParams): Promise<OnlineSearchResult> {
    const token = this.options.getModelScopeToken?.();
    if (!token) throw new Error('ModelScope OpenAPI token is not configured');

    const startPage = Math.max(1, params.pageNumber ?? 1);
    if (startPage > MODEL_SCOPE_OPENAPI_MAX_PAGE_COUNT) {
      return { models: [], reachedLimit: true };
    }
    const models: MarketplaceModel[] = [];
    let totalCount: number | undefined;
    let lastPage = startPage - 1;
    const maxPages = resolveOpenApiPageCount(params.limit);
    for (let offset = 0; offset < maxPages; offset += 1) {
      const page = startPage + offset;
      if (page > MODEL_SCOPE_OPENAPI_MAX_PAGE_COUNT) break;
      let payload: unknown = null;
      let pageError: unknown;
      for (let retry = 0; retry <= MODEL_SCOPE_OPENAPI_PAGE_RETRY_COUNT; retry += 1) {
        try {
          payload = await this.fetchModelScopeOpenApiPage(
            buildModelScopeOpenApiModelsUrl(params.query?.trim() ?? '', page),
            token,
          );
          break;
        } catch (error) {
          pageError = error;
          if (models.length === 0 && retry === MODEL_SCOPE_OPENAPI_PAGE_RETRY_COUNT) {
            throw error;
          }
        }
      }
      if (!payload && models.length > 0) {
        console.warn(`[Marketplace] ModelScope OpenAPI page ${page} failed after ${MODEL_SCOPE_OPENAPI_PAGE_RETRY_COUNT + 1} attempts (${models.length} models so far):`, String(pageError));
        break;
      }
      if (!payload) break;
      const pageResult = extractModelScopeOpenApiPage(payload);
      const records = pageResult.records;
      totalCount = pageResult.totalCount ?? totalCount;
      if (pageResult.totalCount === 0 || records.length === 0) break;
      models.push(...records.map((record) => toMarketplaceModelFromRecord(record)));
      lastPage = page;
      if (models.length >= resolveLimit(params.limit, DEFAULT_LIMIT)) break;
    }
    if (models.length === 0) return { models: [], totalCount };
    const limit = resolveLimit(params.limit, DEFAULT_LIMIT);
    const nextPageNumber = totalCount
      && lastPage < MODEL_SCOPE_OPENAPI_MAX_PAGE_COUNT
      && lastPage * MODEL_SCOPE_OPENAPI_PAGE_SIZE < totalCount
      ? lastPage + 1
      : undefined;
    return {
      models: models.slice(0, limit),
      totalCount,
      nextPageNumber,
    };
  }

  private async fetchModelScopeOpenApiPage(url: string, initialToken: string): Promise<unknown> {
    let token = initialToken;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MODEL_SCOPE_OPENAPI_RATE_LIMIT_RETRIES; attempt += 1) {
      try {
        return await fetchJsonWithTimeout(url, { Authorization: `Bearer ${token}` });
      } catch (error) {
        lastError = error;
        if (!isRateLimitError(error)) throw error;
        const nextToken = this.options.getModelScopeToken?.();
        if (!nextToken || nextToken === token) break;
        token = nextToken;
      }
    }
    throw lastError;
  }

  private async fetchModelScopeSearchApi(params: MarketplaceSearchParams): Promise<MarketplaceModel[]> {
    const query = params.query?.trim() ?? '';
    const url = buildModelScopeSearchApiUrl(query);
    const payload = await fetchJsonWithTimeout(url);
    const records = extractMarketplaceIndexRecords(payload);
    const models = records.map((record) => toMarketplaceModelFromRecord(record));
    if (models.length === 0) {
      throw new Error('ModelScope search returned no GGUF repositories');
    }
    return models.slice(0, DEFAULT_LIMIT);
  }

  private async fetchModelScopeLibrary(params: MarketplaceSearchParams): Promise<MarketplaceModel[]> {
    const html = await fetchTextWithTimeout(buildModelScopeLibraryUrl(params.query?.trim() ?? ''));
    const repoIds = parseModelScopeGgufLibraryHtml(html);
    if (repoIds.length === 0) {
      throw new Error('ModelScope GGUF library page structure changed');
    }
    return repoIds.map((repoId) => toMarketplaceModelFromRecord({ repoId }));
  }
}

function toMarketplaceModel(
  entry: CuratedModelEntry,
  options: { isFeatured: boolean },
): MarketplaceModel {
  const repoId = entry.name.trim();
  const tags = unique([...entry.tags, ...classifyTaskTags(repoId, entry.description, entry.tags)]);
  return {
    source: MARKETPLACE_SOURCE,
    id: repoId,
    repoId,
    name: repoId,
    description: entry.description,
    tags,
    sizes: entry.sizes,
    recommendedTag: entry.recommendedTag,
    capability: resolvePrimaryCapability(tags),
    filePath: entry.filePath,
    downloads: entry.downloads,
    detailUrl: entry.detailUrl ?? `https://www.modelscope.cn/models/${repoId}`,
    parameterCount: entry.parameterCount,
    installed: false,
    isFeatured: options.isFeatured,
  };
}

function toMarketplaceModelFromRecord(record: MarketplaceIndexRecord): MarketplaceModel {
  const repoId = record.repoId.trim();
  const sizes = record.sizes?.length ? record.sizes : inferSizesFromRepoId(repoId);
  const tags = unique([
    ...(record.tags ?? []),
    ...classifyTaskTags(repoId, record.description ?? '', record.tags ?? []),
  ]);
  return {
    source: MARKETPLACE_SOURCE,
    id: repoId,
    repoId,
    name: repoId,
    description: record.description?.trim() || `${repoId} GGUF repository on ModelScope.`,
    tags,
    sizes,
    recommendedTag: resolveRecommendedTag(record.filePath),
    capability: resolvePrimaryCapability(tags),
    filePath: record.filePath,
    downloads: record.downloads,
    detailUrl: record.detailUrl ?? `https://www.modelscope.cn/models/${repoId}`,
    parameterCount: record.parameterCount ?? resolveParameterCount(sizes),
    installed: false,
    isFeatured: false,
  };
}

function buildModelScopeSearchApiUrl(query: string): string {
  const params = new URLSearchParams({
    PageNumber: '1',
    PageSize: '200',
    SortBy: 'Downloads',
    Task: 'text-generation',
  });
  if (query) params.set('Search', query);
  return `${MODEL_SCOPE_SEARCH_API_URL}?${params.toString()}`;
}

function buildModelScopeOpenApiModelsUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    page_number: String(page),
    page_size: String(MODEL_SCOPE_OPENAPI_PAGE_SIZE),
    sort: 'downloads',
    'filter.library': 'gguf',
  });
  if (query) {
    params.set('search', query);
  }
  return `${MODEL_SCOPE_OPENAPI_MODELS_URL}?${params.toString()}`;
}

function resolveOpenApiPageCount(limit: number | undefined): number {
  const resolvedLimit = resolveLimit(limit, DEFAULT_LIMIT);
  return Math.min(
    MODEL_SCOPE_OPENAPI_MAX_PAGE_COUNT,
    Math.max(1, Math.ceil(resolvedLimit / MODEL_SCOPE_OPENAPI_PAGE_SIZE)),
  );
}

function buildModelScopeLibraryUrl(query: string): string {
  const params = new URLSearchParams();
  params.set('other', 'gguf');
  if (query) params.set('search', query);
  return `https://www.modelscope.cn/models?${params.toString()}`;
}

async function fetchJsonWithTimeout(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MARKETPLACE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'RongxinAI/modelscope-gguf-marketplace', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ModelScope marketplace API failed: HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MARKETPLACE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'RongxinAI/modelscope-gguf-marketplace' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ModelScope marketplace page failed: HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractMarketplaceIndexRecords(payload: unknown): MarketplaceIndexRecord[] {
  const records = extractRecords(payload);
  const models = records
    .map((record) => {
      const owner = readRecordString(record.Path)
        || readRecordString(record.owner)
        || readRecordString(record.Owner);
      const repo = readRecordString(record.Name)
        || readRecordString(record.name)
        || readRecordString(record.display_name)
        || readRecordString(record.ModelName)
        || readRecordString(record.model_name);
      const repoId = readRecordString(record.repoId)
        || readRecordString(record.RepoId)
        || readRecordString(record.id)
        || readRecordString(record.model_id)
        || readRecordString(record.modelId)
        || (owner && repo ? `${owner}/${repo}` : undefined);
      const tags = normalizeTagList(record.Tags) ?? normalizeTagList(record.tags) ?? [];
      if (!repoId || !/^[^/\s]+\/[^/\s]+$/.test(repoId) || !isGgufMarketplaceRecord(repoId, tags)) return null;
      return {
        repoId,
        downloads: readRecordNumber(record.Downloads) ?? readRecordNumber(record.downloads) ?? readRecordNumber(record.Likes),
        detailUrl: readRecordString(record.Url) || readRecordString(record.url),
        description: readRecordString(record.Description) || readRecordString(record.description),
        filePath: readRecordString(record.FilePath) || readRecordString(record.filePath),
        tags,
        sizes: normalizeSizeList(record.sizes) ?? normalizeSizeList(record.Tags),
        parameterCount: readRecordNumber(record.parameterCount)
          ?? readRecordNumber(record.ParameterCount)
          ?? readRecordNumber(record.params),
      } satisfies MarketplaceIndexRecord;
    })
    .filter((record): record is NonNullable<typeof record> => record !== null);
  return dedupeIndexRecords(models);
}

function extractModelScopeOpenApiPage(payload: unknown): ModelScopeOpenApiPage {
  const data = isRecord(payload) ? payload.data : undefined;
  if (!isRecord(data)) {
    return { records: extractMarketplaceIndexRecords(payload) };
  }
  const models = Array.isArray(data.models) ? data.models.filter(isRecord) : [];
  return {
    records: extractMarketplaceIndexRecords(models),
    totalCount: readRecordNumber(data.total_count),
  };
}

function isGgufMarketplaceRecord(repoId: string, tags: string[]): boolean {
  return repoId.toLowerCase().includes('gguf')
    || tags.some(tag => tag.toLowerCase().includes('gguf'));
}

function dedupeIndexRecords(records: MarketplaceIndexRecord[]): MarketplaceIndexRecord[] {
  const merged = new Map<string, MarketplaceIndexRecord>();
  for (const record of records) {
    const existing = merged.get(record.repoId);
    merged.set(record.repoId, {
      repoId: record.repoId,
      downloads: record.downloads ?? existing?.downloads,
      detailUrl: record.detailUrl ?? existing?.detailUrl,
      description: record.description ?? existing?.description,
      filePath: record.filePath ?? existing?.filePath,
      tags: unique([...(existing?.tags ?? []), ...(record.tags ?? [])]),
      sizes: unique([...(existing?.sizes ?? []), ...(record.sizes ?? [])]),
      parameterCount: record.parameterCount ?? existing?.parameterCount,
    });
  }
  return Array.from(merged.values());
}

function parseModelScopeGgufLibraryHtml(html: string): string[] {
  const repoIds = new Set<string>();
  const pattern = /href="\/models\/([^"/?#]+\/[^"/?#]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const repoId = decodeHtml(match[1]).trim();
    if (repoId.toLowerCase().includes('gguf')) {
      repoIds.add(repoId);
    }
  }
  return Array.from(repoIds);
}

function mergeMarketplaceModels(
  primary: MarketplaceModel[],
  fallback: MarketplaceModel[],
  limit: number,
): MarketplaceModel[] {
  const merged = new Map<string, MarketplaceModel>();
  for (const model of [...primary, ...fallback]) {
    const key = model.repoId || model.id;
    const existing = merged.get(key);
    merged.set(key, mergeMarketplaceModel(existing, model));
  }
  return Array.from(merged.values()).slice(0, resolveLimit(limit, DEFAULT_LIMIT));
}

function mergeMarketplaceModel(existing: MarketplaceModel | undefined, next: MarketplaceModel): MarketplaceModel {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    tags: unique([...(existing.tags ?? []), ...(next.tags ?? [])]),
    sizes: unique([...(existing.sizes ?? []), ...(next.sizes ?? [])]),
    recommendedTag: next.recommendedTag || existing.recommendedTag,
    downloads: next.downloads ?? existing.downloads,
    detailUrl: next.detailUrl ?? existing.detailUrl,
    parameterCount: next.parameterCount ?? existing.parameterCount,
    filePath: next.filePath ?? existing.filePath,
    installed: next.installed || existing.installed,
    installedPath: next.installedPath ?? existing.installedPath,
    isFeatured: next.isFeatured || existing.isFeatured,
    capability: preferCapability(next.capability, existing.capability),
    description: next.description !== `${next.repoId} GGUF repository on ModelScope.`
      ? next.description
      : existing.description,
  };
}

function annotateInstalledModels(
  models: MarketplaceModel[],
  installed: Map<string, InstalledModelRecord>,
): MarketplaceModel[] {
  return models.map((model) => {
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
    if (!filePath.toLowerCase().endsWith('.gguf')) continue;
    if (/[/\\]mmproj/i.test(filePath)) continue;
    const relative = path.relative(modelscopeRoot, filePath);
    const segments = relative.split(path.sep);
    if (segments.length < 3) continue;
    const [owner, repo] = segments;
    const repoId = `${owner}/${repo}`;
    if (!installed.has(repoId)) {
      installed.set(repoId, { repoId, installedPath: filePath });
    }
  }
  return installed;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of safeReadDir(dir)) {
    const candidate = path.join(dir, entry);
    if (safeIsDirectory(candidate)) {
      files.push(...walkFiles(candidate));
    } else {
      files.push(candidate);
    }
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

function classifyTaskTags(name: string, description: string, tags: string[]): string[] {
  const source = `${name} ${description} ${tags.join(' ')}`.toLowerCase();
  const inferred = new Set<string>();

  if (/\b(chat|instruct|assistant|conversation|dialogue)\b/.test(source)) inferred.add(MarketplaceCapability.Chat);
  if (/\b(reasoning|thinking|reasoner|math|stem|qwq|r1)\b/.test(source)) inferred.add(MarketplaceCapability.Reasoning);
  if (/\b(code|coder|coding|programming|developer|swe|devstral)\b/.test(source)) inferred.add(MarketplaceCapability.Code);
  if (/\b(embed|embedding|retrieval|rerank|reranker)\b/.test(source)) inferred.add(MarketplaceCapability.Embedding);
  if (/\b(vision|visual|vl|multimodal|ocr|image)\b/.test(source)) inferred.add(MarketplaceCapability.Vision);

  if (inferred.size === 0 || (!inferred.has(MarketplaceCapability.Embedding) && !inferred.has(MarketplaceCapability.Vision))) {
    inferred.add(MarketplaceCapability.Chat);
  }
  return [...inferred];
}

function inferSizesFromRepoId(repoId: string): string[] {
  const match = repoId.match(/(\d+(?:\.\d+)?)\s*[bB]/);
  return match ? [`${match[1]}B`] : [];
}

function resolveParameterCount(sizes: string[]): number | undefined {
  for (const size of sizes) {
    const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*B$/i);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isFinite(count)) return count * 1_000_000_000;
  }
  return undefined;
}

function resolvePrimaryCapability(tags: string[]): MarketplaceModel['capability'] {
  const normalized = tags.map((tag) => tag.toLowerCase());
  if (normalized.includes(MarketplaceCapability.Reasoning)) return MarketplaceCapability.Reasoning;
  if (normalized.includes(MarketplaceCapability.Code)) return MarketplaceCapability.Code;
  if (normalized.includes(MarketplaceCapability.Embedding)) return MarketplaceCapability.Embedding;
  if (normalized.includes(MarketplaceCapability.Vision)) return MarketplaceCapability.Vision;
  return MarketplaceCapability.Chat;
}

function preferCapability(
  next: MarketplaceModel['capability'],
  existing: MarketplaceModel['capability'],
): MarketplaceModel['capability'] {
  const priority: Record<MarketplaceModel['capability'], number> = {
    reasoning: 5,
    code: 4,
    vision: 3,
    embedding: 2,
    chat: 1,
  };
  return priority[next] >= priority[existing] ? next : existing;
}

function resolveRecommendedTag(filePath?: string): string {
  if (!filePath) return 'GGUF';
  const fileName = path.basename(filePath, '.gguf');
  return fileName.match(/\b(Q[2-8](?:_[A-Z0-9]+){0,3}|F16|F32|BF16|IQ[1-4]_[A-Z0-9_]+)\b/i)?.[1]?.toUpperCase() ?? 'GGUF';
}

function filterMarketplaceModels(models: MarketplaceModel[], params: MarketplaceSearchParams): MarketplaceModel[] {
  const requiredTags = new Set([
    ...(params.tags ?? []),
    ...tagsForTask(params.task),
  ].map((tag) => tag.toLowerCase()));

  return models
    .filter((model) => !params.source || params.source === 'all' || params.source === model.source)
    .filter((model) => !params.featuredOnly || Boolean(model.isFeatured))
    .filter((model) => matchesQuery(model, params.query))
    .filter((model) => matchesTags(model, requiredTags))
    .filter((model) => matchesSizeFilter(model, params.size));
}

function sortMarketplaceModels(models: MarketplaceModel[], params: MarketplaceSearchParams): MarketplaceModel[] {
  const emptyQuery = !params.query?.trim();
  return [...models].sort((a, b) => {
    if (emptyQuery && a.isFeatured !== b.isFeatured) {
      return a.isFeatured ? -1 : 1;
    }
    if (a.installed !== b.installed) {
      return a.installed ? -1 : 1;
    }
    const capabilityDiff = capabilityScore(b.capability) - capabilityScore(a.capability);
    if (capabilityDiff !== 0 && params.task === 'reasoning') {
      return capabilityDiff;
    }
    const downloadsDiff = (b.downloads ?? 0) - (a.downloads ?? 0);
    if (downloadsDiff !== 0) return downloadsDiff;
    const paramsDiff = (b.parameterCount ?? 0) - (a.parameterCount ?? 0);
    if (paramsDiff !== 0 && emptyQuery) return paramsDiff;
    return a.repoId.localeCompare(b.repoId);
  });
}

function capabilityScore(capability: MarketplaceModel['capability']): number {
  switch (capability) {
    case MarketplaceCapability.Reasoning: return 5;
    case MarketplaceCapability.Code: return 4;
    case MarketplaceCapability.Vision: return 3;
    case MarketplaceCapability.Embedding: return 2;
    case MarketplaceCapability.Chat:
    default:
      return 1;
  }
}

function matchesQuery(model: MarketplaceModel, query?: string): boolean {
  if (!query?.trim()) return true;
  const q = query.toLowerCase();
  return [
    model.repoId,
    model.description,
    model.tags.join(' '),
    model.sizes.join(' '),
    model.recommendedTag,
    model.capability,
  ].some((value) => value.toLowerCase().includes(q));
}

function matchesTags(model: MarketplaceModel, required: Set<string>): boolean {
  if (required.size === 0) return true;
  const tags = new Set(model.tags.map((tag) => tag.toLowerCase()));
  tags.add(model.capability);
  return Array.from(required).every((tag) => tags.has(tag));
}

function tagsForTask(task?: MarketplaceSearchParams['task']): string[] {
  switch (task) {
    case 'chat': return [MarketplaceCapability.Chat];
    case 'reasoning': return [MarketplaceCapability.Reasoning];
    case 'embedding': return [MarketplaceCapability.Embedding];
    case 'code': return [MarketplaceCapability.Code];
    case 'vision': return [MarketplaceCapability.Vision];
    default: return [];
  }
}

function matchesSizeFilter(model: MarketplaceModel, size?: MarketplaceSearchParams['size']): boolean {
  if (!size || size === 'all') return true;
  const count = resolveParamCount(model);
  if (count === null) return true;
  const billions = count / 1_000_000_000;
  switch (size) {
    case 'small': return billions < 4;
    case 'desktop': return billions >= 4 && billions <= 8;
    case 'workstation': return billions > 8 && billions <= 32;
    case 'large': return billions > 32;
    default: return true;
  }
}

function resolveParamCount(model: MarketplaceModel): number | null {
  if (typeof model.parameterCount === 'number' && Number.isFinite(model.parameterCount)) {
    return model.parameterCount;
  }
  return resolveParameterCount(model.sizes) ?? null;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean as unknown as (item: T) => boolean))];
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: '\'',
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();
    if (normalized.startsWith('#x')) {
      const cp = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : entity;
    }
    if (normalized.startsWith('#')) {
      const cp = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : entity;
    }
    return named[normalized] ?? entity;
  });
}

function resolveLimit(limit: number | undefined, fallback: number): number {
  return limit && limit > 0 ? limit : fallback;
}

/** Prefix for OpenAPI auth failures — renderer uses this to show "invalid token". */
const OPENAPI_AUTH_ERROR_PREFIX = 'AUTH_ERROR:';

function toMarketplaceWarning(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/\bHTTP 40[13]\b/.test(raw)) {
    return `${OPENAPI_AUTH_ERROR_PREFIX}${raw}`;
  }
  return raw;
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('HTTP 429');
}

function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const records: Record<string, unknown>[] = [];
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      if (item.every(isRecord)) records.push(...item);
      item.forEach((child) => stack.push(child));
      continue;
    }
    if (!isRecord(item)) continue;
    Object.values(item).forEach((child) => {
      if (Array.isArray(child) || isRecord(child)) stack.push(child);
    });
  }
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readRecordNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/[,\s]/g, '');
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeTagList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function normalizeSizeList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const sizes = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => /^\d+(?:\.\d+)?B$/i.test(item));
    return sizes.length > 0 ? sizes : undefined;
  }
  return undefined;
}

export const __test__parseModelScopeGgufLibraryHtml = parseModelScopeGgufLibraryHtml;
export const __test__mergeMarketplaceModels = mergeMarketplaceModels;
