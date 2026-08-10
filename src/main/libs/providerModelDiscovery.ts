import {
  ApiFormat,
  type DiscoveredProviderModel,
  ProviderModelDiscoveryErrorCode,
  type ProviderModelDiscoveryErrorCode as ProviderModelDiscoveryErrorCodeValue,
  type ProviderModelDiscoveryRequest,
} from '../../shared/providers';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ERROR_BODY_MAX_CHARS = 512;
const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
] as const;

export class ProviderModelDiscoveryError extends Error {
  constructor(
    readonly code: ProviderModelDiscoveryErrorCodeValue,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderModelDiscoveryError';
  }
}

function normalizedBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderModelDiscoveryError(
      ProviderModelDiscoveryErrorCode.InvalidConfig,
      'The provider base URL must use HTTP or HTTPS.',
    );
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function stripCompatSuffix(baseUrl: string): string | null {
  const lowerUrl = baseUrl.toLowerCase();
  const suffix = KNOWN_COMPAT_SUFFIXES.find(candidate => lowerUrl.endsWith(candidate));
  return suffix ? baseUrl.slice(0, -suffix.length).replace(/\/+$/, '') : null;
}

function hasVersionSegment(baseUrl: string): boolean {
  return /\/v\d+(?:(?:alpha|beta)\d*)?$/i.test(baseUrl);
}

export function buildProviderModelsUrlCandidates(baseUrl: string): string[] {
  const normalized = normalizedBaseUrl(baseUrl);
  const candidates: string[] = [];

  if (hasVersionSegment(normalized)) {
    candidates.push(`${normalized}/models`);
    if (!normalized.toLowerCase().endsWith('/v1')) {
      candidates.push(`${normalized}/v1/models`);
    }
  } else {
    candidates.push(`${normalized}/v1/models`);
  }

  const compatRoot = stripCompatSuffix(normalized);
  if (compatRoot) {
    candidates.push(`${compatRoot}/v1/models`, `${compatRoot}/models`);
  }

  return [...new Set(candidates)];
}

function normalizedModelId(rawId: unknown): string | null {
  if (typeof rawId !== 'string') return null;
  const id = rawId.trim().replace(/^models\//, '');
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseProviderModelsResponse(payload: unknown): DiscoveredProviderModel[] {
  if (!isRecord(payload)) {
    throw new ProviderModelDiscoveryError(
      ProviderModelDiscoveryErrorCode.UnsupportedFormat,
      'The model endpoint returned an unsupported response.',
    );
  }

  let entries: DiscoveredProviderModel[] | null = null;
  if (Array.isArray(payload.data)) {
    entries = payload.data.flatMap(item => {
      if (!isRecord(item)) return [];
      const id = normalizedModelId(item.id);
      if (!id) return [];
      return [
        {
          id,
          ...(optionalString(item.name) ? { displayName: optionalString(item.name) } : {}),
          ...(optionalString(item.owned_by) ? { ownedBy: optionalString(item.owned_by) } : {}),
        },
      ];
    });
  } else if (Array.isArray(payload.models)) {
    entries = payload.models.flatMap(item => {
      if (!isRecord(item)) return [];
      const id = normalizedModelId(item.name ?? item.id);
      if (!id) return [];
      return [
        {
          id,
          ...(optionalString(item.displayName)
            ? { displayName: optionalString(item.displayName) }
            : {}),
        },
      ];
    });
  }

  if (!entries) {
    throw new ProviderModelDiscoveryError(
      ProviderModelDiscoveryErrorCode.UnsupportedFormat,
      'The model endpoint returned an unsupported response.',
    );
  }

  const modelsById = new Map<string, DiscoveredProviderModel>();
  for (const entry of entries) {
    if (!modelsById.has(entry.id)) modelsById.set(entry.id, entry);
  }
  return [...modelsById.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new ProviderModelDiscoveryError(
      ProviderModelDiscoveryErrorCode.ResponseTooLarge,
      'The model endpoint response is too large.',
    );
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProviderModelDiscoveryError(
        ProviderModelDiscoveryErrorCode.ResponseTooLarge,
        'The model endpoint response is too large.',
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function requestHeaders(request: ProviderModelDiscoveryRequest): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = request.apiKey?.trim();
  if (!apiKey) return headers;

  if (request.apiFormat === ApiFormat.Anthropic) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (request.apiFormat === ApiFormat.Gemini) {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function errorBody(text: string): string {
  return text.length > ERROR_BODY_MAX_CHARS ? `${text.slice(0, ERROR_BODY_MAX_CHARS)}...` : text;
}

export async function discoverProviderModels(
  request: ProviderModelDiscoveryRequest,
  fetchImpl: typeof fetch,
): Promise<DiscoveredProviderModel[]> {
  const candidates = buildProviderModelsUrlCandidates(request.baseUrl);
  const headers = requestHeaders(request);

  for (const candidate of candidates) {
    let response: Response;
    try {
      response = await fetchImpl(candidate, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof ProviderModelDiscoveryError) throw error;
      const isTimeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new ProviderModelDiscoveryError(
        isTimeout
          ? ProviderModelDiscoveryErrorCode.Timeout
          : ProviderModelDiscoveryErrorCode.Network,
        isTimeout ? 'The model request timed out.' : 'The model request failed.',
      );
    }

    if (response.status === 404 || response.status === 405) {
      await response.body?.cancel();
      continue;
    }

    const body = await readBoundedText(response);
    if (response.ok) {
      try {
        return parseProviderModelsResponse(JSON.parse(body));
      } catch (error) {
        if (error instanceof ProviderModelDiscoveryError) throw error;
        throw new ProviderModelDiscoveryError(
          ProviderModelDiscoveryErrorCode.UnsupportedFormat,
          'The model endpoint returned invalid JSON.',
        );
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderModelDiscoveryError(
        ProviderModelDiscoveryErrorCode.Authentication,
        `The model endpoint rejected authentication (${response.status}).`,
      );
    }
    throw new ProviderModelDiscoveryError(
      ProviderModelDiscoveryErrorCode.Http,
      `The model endpoint returned HTTP ${response.status}: ${errorBody(body)}`,
    );
  }

  throw new ProviderModelDiscoveryError(
    ProviderModelDiscoveryErrorCode.EndpointNotFound,
    'No supported model endpoint was found.',
  );
}
