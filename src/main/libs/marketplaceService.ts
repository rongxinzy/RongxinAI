import type {
  MarketplaceModel,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../shared/marketplace';
import curatedModels from '../resources/ollama-curated-models.json';

type CuratedModelEntry = {
  name: string;
  description: string;
  tags: string[];
  sizes: string[];
  recommendedTag: string;
  downloads?: number;
  detailUrl?: string;
  parameterCount?: number;
};

export class MarketplaceService {
  async search(params: MarketplaceSearchParams = {}): Promise<MarketplaceSearchResult> {
    const limit = params.limit && params.limit > 0 ? params.limit : 120;
    const localModels = this.searchLocal(params);
    try {
      const onlineModels = await this.searchOnline(params);
      const merged = sortMarketplaceModels(filterMarketplaceModels(onlineModels, params), params);
      return { models: merged.slice(0, limit) };
    } catch {
      return { models: localModels.slice(0, limit) };
    }
  }

  searchLocal(params: MarketplaceSearchParams = {}): MarketplaceModel[] {
    const limit = params.limit && params.limit > 0 ? params.limit : 120;
    return sortMarketplaceModels(
      filterMarketplaceModels(
        (curatedModels as CuratedModelEntry[]).map(toMarketplaceModel),
        params,
      ),
      params,
    ).slice(0, limit);
  }

  private async searchOnline(params: MarketplaceSearchParams): Promise<MarketplaceModel[]> {
    const query = params.query?.trim() ?? '';
    const url = buildSearchUrl(query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'RongxinAI/marketplace',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Ollama search failed: HTTP ${response.status}`);
      }
      const html = await response.text();
      const parsed = parseOllamaSearchHtml(html, query);
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toMarketplaceModel(entry: CuratedModelEntry): MarketplaceModel {
  const tags = unique([...entry.tags, ...classifyTaskTags(entry.name, entry.description, entry.tags)]);
  return {
    source: 'ollama-library',
    id: entry.name,
    name: entry.name,
    description: entry.description,
    tags,
    sizes: entry.sizes,
    recommendedTag: entry.recommendedTag,
    downloads: entry.downloads,
    installName: entry.name,
    detailUrl: entry.detailUrl,
    parameterCount: entry.parameterCount,
  };
}

function buildSearchUrl(query: string): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const suffix = params.toString();
  return `https://ollama.com/search${suffix ? `?${suffix}` : ''}`;
}

function parseOllamaSearchHtml(html: string, _query: string): MarketplaceModel[] {
  const models: MarketplaceModel[] = [];
  const liRegex = /<li\b[^>]*\bx-test-model\b[\s\S]*?<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = liRegex.exec(html)) !== null) {
    const block = match[0];
    const model = parseModelBlock(block);
    if (model) {
      models.push(model);
    }
  }
  if (models.length === 0 && !/No models found\./i.test(html)) {
    if (!/<li\b[^>]*\bx-test-model\b/i.test(html)) {
      throw new Error('Ollama marketplace page structure changed');
    }
  }
  return models;
}

function parseModelBlock(block: string): MarketplaceModel | null {
  const hrefMatch = block.match(/<a\b[^>]*href="([^"]+)"/i);
  const nameMatch = block.match(/<span\b[^>]*\bx-test-search-response-title\b[^>]*>([\s\S]*?)<\/span>/i)
    ?? block.match(/<div\b[^>]*title="([^"]+)"/i);
  if (!hrefMatch || !nameMatch) return null;

  const rawName = decodeHtml(stripTags(nameMatch[1])).trim();
  if (!rawName) return null;

  const description = parseDescription(block);
  const tags = parseRepeatedText(block, /<span\b[^>]*\bx-test-capability\b[^>]*>([\s\S]*?)<\/span>/gi)
    .map((t) => t.toLowerCase());
  const sizes = parseRepeatedText(block, /<span\b[^>]*\bx-test-size\b[^>]*>([\s\S]*?)<\/span>/gi)
    .map(formatSizeText);
  const downloads = parsePullCount(
    matchFirst(block, /<span\b[^>]*\bx-test-pull-count\b[^>]*>([\s\S]*?)<\/span>/i),
  );

  const installName = toInstallName(hrefMatch[1], rawName);
  const allTags = unique([...tags, ...classifyTaskTags(rawName, description, tags)]);

  return {
    source: 'ollama-library',
    id: installName,
    name: installName,
    description: description || 'Ollama Library model.',
    tags: allTags,
    sizes: sizes.length > 0 ? sizes : inferSizesFromName(rawName),
    recommendedTag: sizes[0] ?? 'Ollama',
    downloads,
    installName,
    detailUrl: `https://ollama.com${hrefMatch[1].startsWith('/') ? hrefMatch[1] : `/${hrefMatch[1]}`}`,
    parameterCount: resolveParameterCount(sizes),
  };
}

function parseDescription(block: string): string {
  const desc = matchFirst(
    block,
    /<p\b[^>]*class="[^"]*\btext-neutral-800\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  return desc ? decodeHtml(stripTags(desc)).replace(/\s+/g, ' ').trim() : '';
}

function toInstallName(href: string, fallback: string): string {
  const normalized = href.replace(/^https?:\/\/ollama\.com/i, '').replace(/^\/+/, '');
  if (normalized.startsWith('library/')) {
    return normalized.slice('library/'.length).split(/[?#]/)[0] || fallback;
  }
  return normalized.split(/[?#]/)[0] || fallback;
}

function parsePullCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const text = decodeHtml(stripTags(value)).replace(/\s+/g, ' ').trim().toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*([kmb])?\s*(?:downloads?|pulls?)/i)
    ?? text.match(/(?:downloads?|pulls?)\s*(\d+(?:\.\d+)?)\s*([kmb])?/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*([kmb])/i);
  if (!match) return undefined;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return undefined;
  const multiplier = match[2] === 'b'
    ? 1_000_000_000
    : match[2] === 'm'
      ? 1_000_000
      : match[2] === 'k'
        ? 1_000
        : 1;
  return Math.round(num * multiplier);
}

function formatSizeText(value: string): string {
  return value.trim();
}

function parseRepeatedText(html: string, pattern: RegExp): string[] {
  return Array.from(html.matchAll(pattern), (m) =>
    decodeHtml(stripTags(m[1])).trim(),
  ).filter(Boolean);
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
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

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function classifyTaskTags(
  name: string,
  description: string,
  tags: string[],
): string[] {
  const source = `${name} ${description} ${tags.join(' ')}`.toLowerCase();
  const inferred = new Set<string>();

  if (/\b(chat|instruct|assistant|conversation|dialogue)\b/.test(source)) inferred.add('chat');
  if (/\b(reasoning|thinking|reasoner|math|stem)\b/.test(source)) inferred.add('reasoning');
  if (/\b(code|coder|coding|programming|developer|swe|devstral)\b/.test(source)) inferred.add('code');
  if (/\b(embed|embedding|retrieval|rerank|reranker)\b/.test(source)) inferred.add('embedding');
  if (/\b(vision|visual|vl|multimodal|ocr|image)\b/.test(source)) inferred.add('vision');

  // Most Ollama Library generative models can be used for chat even when the
  // search page omits an explicit chat capability.
  if (!inferred.has('embedding')) inferred.add('chat');

  return [...inferred];
}

function inferSizesFromName(name: string): string[] {
  const match = name.match(/(\d+\.?\d*)[bB]/);
  if (match) {
    return [`${match[1]}B`];
  }
  return [];
}

function resolveParameterCount(sizes: string[]): number | undefined {
  for (const size of sizes) {
    const m = size.trim().match(/^(\d+(?:\.\d+)?)\s*B$/);
    if (m) {
      const num = Number(m[1]);
      if (Number.isFinite(num)) return num * 1_000_000_000;
    }
  }
  return undefined;
}

function filterMarketplaceModels(
  models: MarketplaceModel[],
  params: MarketplaceSearchParams,
): MarketplaceModel[] {
  const requiredTags = new Set([
    ...(params.tags ?? []),
    ...tagsForTask(params.task),
  ].map((t) => t.toLowerCase()));

  return models
    .filter((m) => !params.source || params.source === 'all' || params.source === m.source)
    .filter((m) => matchesQuery(m, params.query))
    .filter((m) => matchesTags(m, requiredTags))
    .filter((m) => matchesSizeFilter(m, params.size));
}

function sortMarketplaceModels(
  models: MarketplaceModel[],
  _params: MarketplaceSearchParams,
): MarketplaceModel[] {
  return [...models].sort((a, b) => {
    const downloadsDiff = (b.downloads ?? 0) - (a.downloads ?? 0);
    if (downloadsDiff !== 0) return downloadsDiff;
    return a.name.localeCompare(b.name);
  });
}

function matchesQuery(model: MarketplaceModel, query?: string): boolean {
  if (!query?.trim()) return true;
  const q = query.toLowerCase();
  const name = model.name.toLowerCase();
  const desc = model.description.toLowerCase();
  const tags = model.tags.join(' ').toLowerCase();
  return name.includes(q) || desc.includes(q) || tags.includes(q);
}

function matchesTags(model: MarketplaceModel, required: Set<string>): boolean {
  if (required.size === 0) return true;
  const modelTags = new Set(model.tags.map((t) => t.toLowerCase()));
  return Array.from(required).every((t) => modelTags.has(t));
}

function tagsForTask(task?: MarketplaceSearchParams['task']): string[] {
  switch (task) {
    case 'chat': return ['chat'];
    case 'reasoning': return ['reasoning'];
    case 'embedding': return ['embedding'];
    case 'code': return ['code'];
    case 'vision': return ['vision'];
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
    case 'workstation': return billions > 8 && billions <= 14;
    case 'large': return billions > 14;
    default: return true;
  }
}

function resolveParamCount(model: MarketplaceModel): number | null {
  if (typeof model.parameterCount === 'number' && Number.isFinite(model.parameterCount)) {
    return model.parameterCount;
  }
  for (const size of model.sizes) {
    const m = size.trim().match(/^(\d+(?:\.\d+)?)\s*([bB])$/);
    if (m) {
      const amount = Number(m[1]);
      if (Number.isFinite(amount)) {
        return m[2].toLowerCase() === 'b' ? amount * 1_000_000_000 : amount * 1_000_000;
      }
    }
  }
  return null;
}
