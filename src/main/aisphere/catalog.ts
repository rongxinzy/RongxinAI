import { AISphereError, type AISphereModel } from '../../shared/aisphere';
import { ModelCapabilityStatus } from '../../shared/providers';

export interface PlatformModel extends AISphereModel {
  url: string;
  apiKey: string;
}

export function normalizePlatformAddress(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048)
    throw new Error(AISphereError.InvalidAddress);
  try {
    const url = new URL(input.trim());
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/*$/.test(url.pathname)
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(AISphereError.InvalidAddress);
  }
}

function text(input: unknown, limit: number): string {
  if (
    typeof input !== 'string' ||
    !input.trim() ||
    input.length > limit ||
    /[\x00-\x1f\x7f]/.test(input)
  ) {
    throw new Error(AISphereError.InvalidModels);
  }
  return input.trim();
}

function limit(input: unknown): number | undefined {
  if (input === undefined || input === 0) return undefined;
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new Error(AISphereError.InvalidModels);
  }
  return input;
}

export function parsePlatformModels(input: unknown): PlatformModel[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !('code' in input) ||
    input.code !== 0 ||
    !('model_list' in input) ||
    !Array.isArray(input.model_list) ||
    input.model_list.length > 256
  ) {
    throw new Error(AISphereError.InvalidModels);
  }
  const ids = new Set<string>();
  return input.model_list.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error(AISphereError.InvalidModels);
    const item = raw as Record<string, unknown>;
    const id = text(item.name, 256);
    if (ids.has(id)) throw new Error(AISphereError.InvalidModels);
    ids.add(id);
    const url = new URL(text(item.url, 2048));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error(AISphereError.InvalidModels);
    }
    const declared = (value: unknown) =>
      value === true
        ? ModelCapabilityStatus.Supported
        : value === false
          ? ModelCapabilityStatus.Unsupported
          : ModelCapabilityStatus.Unknown;
    return {
      id,
      name: id,
      url: url.href,
      apiKey: text(item.api_key, 16384),
      capabilities: {
        // Tool flags are hints; requests establish actual support.
        toolCalling: ModelCapabilityStatus.Unknown,
        imageInput: declared(item.image),
        videoInput: declared(item.video),
        reasoning: declared(item.thinking),
      },
      contextWindow: limit(item.context_length),
      maxInput: limit(item.max_input),
      maxTokens: limit(item.max_output),
    };
  });
}

export function publicModel({ apiKey: _key, url: _url, ...model }: PlatformModel): AISphereModel {
  return model;
}
