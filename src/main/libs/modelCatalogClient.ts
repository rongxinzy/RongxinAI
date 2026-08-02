import type {
  MarketplaceModel,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../shared/marketplace';

const DEFAULT_CATALOG_URL = 'https://models.rongxzyai.com';
// A cold catalogue query hydrates ModelScope detail and checksum-backed GGUF
// files before it becomes cacheable. Keep the desktop timeout above that real
// cold-path latency; cached responses still return immediately.
const CATALOG_TIMEOUT_MS = 30_000;
const NON_GENERATIVE_GGUF_PATTERN =
  /(?:^|[/\s._-])(?:embedding|embed|bge|e5|gte|rerank(?:er)?|sentence[-_ ]transformers?|clip|siglip|colbert|vector(?:izer)?|text[-_ ]embedding|flux|comfyui|stable[-_ ]diffusion|sdxl|controlnet|diffusion|vae|image[-_ ]generation|image[-_ ]to[-_ ]image|lora|adapter)(?=$|[/\s._-])/i;

// Injected at construction so the Electron main process can use net.fetch
// (Chromium network stack, honours the system proxy) instead of the plain
// undici fetch, which ignores both system and HTTP(S)_PROXY settings.
export type CatalogFetchLike = (input: string | Request, init?: RequestInit) => Promise<Response>;

type CatalogModelPayload = Omit<MarketplaceModel, 'capability' | 'sizes'> & {
  capability?: string | string[];
  sizes?: string[];
};

const MARKETPLACE_CAPABILITIES = ['chat', 'reasoning', 'embedding', 'code', 'vision'] as const;

function isVerifiedGgufCatalogModel(model: MarketplaceModel): boolean {
  const recommended = model.files?.find(file => file.isRecommended);
  return Boolean(
    model.metadataStatus === 'verified' &&
      model.runtime?.format === 'gguf' &&
      model.runtime.ggufFilesVerified &&
      recommended?.path.toLowerCase().endsWith('.gguf') &&
      recommended.sizeBytes &&
      recommended.sha256 &&
      /^[a-f0-9]{64}$/i.test(recommended.sha256),
  );
}

function normalizeModel(value: CatalogModelPayload): MarketplaceModel {
  const capabilities = Array.isArray(value.capability) ? value.capability : value.capability ? [value.capability] : ['chat'];
  const normalizedCapabilities = capabilities.filter((candidate): candidate is MarketplaceModel['capability'] =>
    MARKETPLACE_CAPABILITIES.includes(candidate as MarketplaceModel['capability']),
  );
  const capability = normalizedCapabilities[0] ?? 'chat';
  return {
    ...value,
    source: 'modelscope-gguf',
    id: value.id || value.repoId,
    repoId: value.repoId,
    name: value.name || value.repoId,
    description: value.description || '可下载到本机进行端侧推理。',
    tags: Array.isArray(value.tags) ? value.tags : [],
    sizes: Array.isArray(value.sizes) ? value.sizes : ['all'],
    recommendedTag: value.recommendedTag || 'GGUF',
    capability,
    capabilities: normalizedCapabilities.length ? normalizedCapabilities : ['chat'],
    installed: Boolean(value.installed),
  };
}

function isGenerativeLanguageModel(model: MarketplaceModel): boolean {
  return !NON_GENERATIVE_GGUF_PATTERN.test(
    [model.repoId, model.name, model.description, ...model.tags].join(' '),
  );
}

export class ModelCatalogClient {
  readonly baseUrl: string;
  private readonly fetchImpl: CatalogFetchLike;

  constructor(
    baseUrl = process.env.ZHIYUAN_MODEL_CATALOG_URL || DEFAULT_CATALOG_URL,
    fetchImpl: CatalogFetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  async search(params: MarketplaceSearchParams = {}): Promise<MarketplaceSearchResult> {
    const url = new URL(`${this.baseUrl}/v1/catalog/search`);
    if (params.query?.trim()) url.searchParams.set('q', params.query.trim());
    if (params.task && params.task !== 'all') url.searchParams.set('task', params.task);
    if (params.size && params.size !== 'all') url.searchParams.set('size', params.size);
    if (params.tags?.length) url.searchParams.set('tags', params.tags.join(','));
    // Device fit is computed from live local hardware and must never be sent to
    // the cloud catalogue as if it were a server-side model property.
    if (params.limit) url.searchParams.set('limit', String(params.limit));
    if (params.pageNumber) url.searchParams.set('page', String(params.pageNumber));
    if (params.featuredOnly) url.searchParams.set('featured', '1');
    const payload = await this.fetchJson(url.toString()) as { models?: CatalogModelPayload[]; totalCount?: number; nextPageNumber?: number; warning?: string; source?: MarketplaceSearchResult['source']; catalogUpdatedAt?: string; scoreVersion?: string };
    return {
      models: (payload.models ?? []).map(normalizeModel).filter(isGenerativeLanguageModel).filter(isVerifiedGgufCatalogModel),
      totalCount: payload.totalCount,
      nextPageNumber: payload.nextPageNumber,
      warning: payload.warning,
      source: payload.source ?? 'cloud-catalog',
      catalogUpdatedAt: payload.catalogUpdatedAt,
      scoreVersion: payload.scoreVersion,
    };
  }

  async bootstrap(): Promise<MarketplaceSearchResult> {
    const payload = await this.fetchJson(`${this.baseUrl}/v1/catalog/bootstrap`) as { models?: CatalogModelPayload[]; totalCount?: number; warning?: string; source?: MarketplaceSearchResult['source']; catalogUpdatedAt?: string; scoreVersion?: string };
    return {
      models: (payload.models ?? []).map(normalizeModel).filter(isGenerativeLanguageModel).filter(isVerifiedGgufCatalogModel), totalCount: payload.totalCount, warning: payload.warning,
      source: payload.source ?? 'cloud-catalog', catalogUpdatedAt: payload.catalogUpdatedAt, scoreVersion: payload.scoreVersion,
    };
  }

  async resolveModel(repoId: string): Promise<MarketplaceModel | null> {
    const [owner, repo] = repoId.trim().split('/');
    if (!owner || !repo) return null;
    const payload = await this.fetchJson(
      `${this.baseUrl}/v1/catalog/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    ) as CatalogModelPayload | { model?: CatalogModelPayload };
    const value: CatalogModelPayload | undefined =
      (payload as { model?: CatalogModelPayload }).model ?? (payload as CatalogModelPayload);
    if (!value || !value.repoId) return null;
    const model = normalizeModel(value);
    return isGenerativeLanguageModel(model) && isVerifiedGgufCatalogModel(model) ? model : null;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'X-Zhiyuan-Client-Id': 'zhiyuan-desktop-catalog-v1',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Model catalog failed: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('模型目录响应超时，请稍后重试。', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function resolveModelCatalogUrl(): string | null {
  const configured = process.env.ZHIYUAN_MODEL_CATALOG_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'test') return null;
  return DEFAULT_CATALOG_URL;
}
