import {
  ApiFormat,
  DiscoveryCapabilitiesSource,
  ModelCapabilityStatus,
  type ModelCapabilities,
  type DiscoveredProviderModel,
  parseLlamaCppRuntimeCapabilities,
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

export function buildLlamaCppPropsUrl(baseUrl: string): string {
  const normalized = normalizedBaseUrl(baseUrl);
  const serverRoot = normalized.replace(/\/v\d+(?:(?:alpha|beta)\d*)?$/i, '');
  return `${serverRoot}/props`;
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

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function firstPositiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = positiveInteger(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function capabilityStatus(value: unknown): ModelCapabilityStatus | undefined {
  if (typeof value === 'boolean') {
    return value ? ModelCapabilityStatus.Supported : ModelCapabilityStatus.Unsupported;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['supported', 'support', 'true', 'yes'].includes(normalized)) {
    return ModelCapabilityStatus.Supported;
  }
  if (['unsupported', 'unsupport', 'false', 'no'].includes(normalized)) {
    return ModelCapabilityStatus.Unsupported;
  }
  return undefined;
}

// Ollama and llama.cpp describe model capabilities as a string list
// (for example ["completion", "multimodal"]) instead of a record; map the
// known tokens onto Agent capability verdicts.
const CAPABILITY_LIST_TOKENS = [
  { token: 'vision', capability: 'imageInput' },
  { token: 'multimodal', capability: 'imageInput' },
  { token: 'multimodal', capability: 'videoInput' },
  { token: 'audio', capability: 'audioInput' },
  { token: 'tools', capability: 'toolCalling' },
  { token: 'thinking', capability: 'reasoning' },
] as const satisfies readonly {
  readonly token: string;
  readonly capability: keyof ModelCapabilities;
}[];

function capabilitiesFromDeclaredList(item: Record<string, unknown>): Partial<ModelCapabilities> {
  if (!Array.isArray(item.capabilities)) return {};
  const declared = new Set(
    item.capabilities
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim().toLowerCase()),
  );
  const verdicts: { -readonly [Key in keyof ModelCapabilities]?: ModelCapabilities[Key] } = {};
  for (const { token, capability } of CAPABILITY_LIST_TOKENS) {
    if (declared.has(token)) verdicts[capability] = ModelCapabilityStatus.Supported;
  }
  return verdicts;
}

function modelCapabilities(item: Record<string, unknown>): Partial<ModelCapabilities> | undefined {
  const declared = nestedRecord(item.capabilities);
  const architecture = nestedRecord(item.architecture);
  const rawModalities = item.modalities ?? architecture?.input_modalities;
  const modalities = Array.isArray(rawModalities)
    ? rawModalities.filter((value): value is string => typeof value === 'string')
    : [];
  const supports = (keys: string[]): ModelCapabilityStatus | undefined => {
    for (const key of keys) {
      const status = capabilityStatus(item[key]) ?? capabilityStatus(declared?.[key]);
      if (status !== undefined) return status;
    }
    return undefined;
  };
  const fromModalities = (names: string[]): ModelCapabilityStatus | undefined =>
    modalities.length > 0
      ? modalities.some(value => names.includes(value.trim().toLowerCase()))
        ? ModelCapabilityStatus.Supported
        : undefined
      : undefined;

  const capabilities: Partial<ModelCapabilities> = {
    toolCalling:
      supports([
        'toolCalling',
        'tool_calling',
        'supports_tools',
        'supports_tool_calls',
        'tools',
        'function_calling',
      ]) ??
      capabilityStatus(declared?.tools) ??
      capabilityStatus(declared?.function_calling) ??
      capabilityStatus(declared?.tool_use),
    imageInput:
      supports([
        'imageInput',
        'image_input',
        'supports_image',
        'supports_image_input',
        'vision',
        'supports_vision',
      ]) ?? fromModalities(['image', 'vision']),
    videoInput:
      supports(['videoInput', 'video_input', 'supports_video', 'supports_video_input']) ??
      fromModalities(['video']),
    audioInput:
      supports(['audioInput', 'audio_input', 'supports_audio', 'supports_audio_input']) ??
      fromModalities(['audio']),
    documentInput: supports([
      'documentInput',
      'document_input',
      'supports_document',
      'supports_document_input',
      'file_input',
      'supports_files',
    ]),
    reasoning: supports([
      'reasoning',
      'supports_reasoning',
      'thinking',
      'supports_thinking',
      'reasoning_content',
    ]),
    ...capabilitiesFromDeclaredList(item),
  };
  const knownEntries = Object.entries(capabilities).filter(([, status]) => status !== undefined);
  return knownEntries.length > 0
    ? (Object.fromEntries(knownEntries) as Partial<ModelCapabilities>)
    : undefined;
}

function modelMetadata(
  item: Record<string, unknown>,
): Pick<DiscoveredProviderModel, 'contextWindow' | 'maxTokens' | 'capabilities'> {
  const topProvider = nestedRecord(item.top_provider);
  const meta = nestedRecord(item.meta);
  const contextWindow = firstPositiveInteger(
    item.contextWindow,
    item.context_window,
    item.contextLength,
    item.context_length,
    item.max_context_length,
    item.input_context_length,
    meta?.n_ctx,
    meta?.context_length,
    topProvider?.context_length,
  );
  const maxTokens = firstPositiveInteger(
    item.maxTokens,
    item.max_tokens,
    item.maxOutputTokens,
    item.max_output_tokens,
    item.max_completion_tokens,
    item.output_token_limit,
    topProvider?.max_completion_tokens,
  );
  const capabilities = modelCapabilities(item);
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(capabilities ? { capabilities } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// llama.cpp answers /v1/models with an OpenAI `data` list that carries no
// capability fields plus an Ollama-compatible `models` list that does; borrow
// missing metadata from the sibling section so either shape yields the same
// verdict.
function withSiblingSectionMetadata(
  siblingItems: unknown[],
): (entry: DiscoveredProviderModel) => DiscoveredProviderModel {
  const siblingsById = new Map<string, Record<string, unknown>>();
  for (const item of siblingItems) {
    if (!isRecord(item)) continue;
    for (const key of ['id', 'name', 'model'] as const) {
      const value = item[key];
      if (typeof value === 'string' && value.trim() && !siblingsById.has(value.trim())) {
        siblingsById.set(value.trim(), item);
      }
    }
  }
  return entry => {
    const sibling = siblingsById.get(entry.id);
    if (!sibling) return entry;
    const metadata = modelMetadata(sibling);
    return {
      ...entry,
      ...(entry.contextWindow === undefined && metadata.contextWindow !== undefined
        ? { contextWindow: metadata.contextWindow }
        : {}),
      ...(entry.maxTokens === undefined && metadata.maxTokens !== undefined
        ? { maxTokens: metadata.maxTokens }
        : {}),
      ...(entry.capabilities === undefined && metadata.capabilities !== undefined
        ? { capabilities: metadata.capabilities }
        : {}),
    };
  };
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
          ...modelMetadata(item),
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
          ...modelMetadata(item),
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

  if (Array.isArray(payload.data) && Array.isArray(payload.models)) {
    entries = entries.map(withSiblingSectionMetadata(payload.models));
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

// llama.cpp declares multimodal modalities on /props rather than in
// /v1/models. The probe is best-effort: any other backend answers 404 or
// non-JSON and discovery keeps its /v1/models results untouched.
async function enrichWithLlamaCppProps(
  request: ProviderModelDiscoveryRequest,
  entries: DiscoveredProviderModel[],
  fetchImpl: typeof fetch,
): Promise<DiscoveredProviderModel[]> {
  if (entries.length === 0) return entries;
  let payload: unknown;
  try {
    const response = await fetchImpl(buildLlamaCppPropsUrl(request.baseUrl), {
      method: 'GET',
      headers: requestHeaders(request),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return entries;
    payload = JSON.parse(await readBoundedText(response));
  } catch {
    return entries;
  }
  const detected = parseLlamaCppRuntimeCapabilities(payload);
  if (Object.keys(detected).length === 0) return entries;
  // A successful /props probe is ground truth for modalities: the server just
  // told us what the loaded model can see, so it overrides stale /v1/models
  // claims (e.g. a sibling section declaring "multimodal" while no mmproj is
  // loaded). The tool verdict is different: chat_template_caps is a template
  // heuristic that many self-hosted deployments report as false for
  // tool-capable models, so it may only fill a gap, never override the entry.
  const probeModalities: { -readonly [K in keyof ModelCapabilities]?: ModelCapabilities[K] } = {};
  for (const key of ['imageInput', 'videoInput', 'audioInput'] as const) {
    const status = detected[key];
    if (status !== undefined) probeModalities[key] = status;
  }
  return entries.map(entry => {
    const capabilities: { -readonly [K in keyof ModelCapabilities]?: ModelCapabilities[K] } = {
      ...(entry.capabilities ?? {}),
      ...probeModalities,
    };
    if (capabilities.toolCalling === undefined && detected.toolCalling !== undefined) {
      capabilities.toolCalling = detected.toolCalling;
    }
    return {
      ...entry,
      capabilities,
      capabilitiesSource: DiscoveryCapabilitiesSource.RuntimeProbe,
    };
  });
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
        const models = parseProviderModelsResponse(JSON.parse(body));
        return request.apiFormat === ApiFormat.OpenAI
          ? await enrichWithLlamaCppProps(request, models, fetchImpl)
          : models;
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
