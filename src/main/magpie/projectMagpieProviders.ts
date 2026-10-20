import type { MagpieProviderApi, MagpieProviderSummary } from '../../shared/magpie/types';
import { HOST_PROVIDER_PREFIX } from './hostProviders';
import { maskApiKey } from './magpieManagerUtils';

function providerModelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item: unknown) => {
      if (typeof item === 'string' && item.length <= 500) return [item];
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const id = (item as Record<string, unknown>).id;
      return typeof id === 'string' && id.length <= 500 ? [id] : [];
    })
    .slice(0, 500);
}

function providerHasKey(raw: Record<string, unknown>): boolean {
  const key = raw.key;
  if (key && typeof key === 'object' && !Array.isArray(key)) {
    return (key as Record<string, unknown>).set === true;
  }
  if (typeof key === 'string') return key.length > 0 && key !== 'magpie-local';
  return false;
}

function providerKeyMasked(
  raw: Record<string, unknown>,
  isHostManaged: boolean,
): string | undefined {
  if (isHostManaged) return 'system-managed';
  const key = raw.key;
  if (key && typeof key === 'object' && !Array.isArray(key)) {
    const masked = (key as Record<string, unknown>).masked;
    if (typeof masked === 'string' && masked.length <= 120) return masked;
  }
  if (typeof key === 'string') return maskApiKey(key);
  return undefined;
}

/** Project upstream `/api/providers` rows to renderer-safe summaries. */
export function projectMagpieProviderSummaries(state: unknown): MagpieProviderSummary[] {
  const body =
    state && typeof state === 'object' && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {};
  const rawList = Array.isArray(body.providers) ? body.providers : [];
  return rawList.flatMap((p: unknown) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
    const row = p as Record<string, unknown>;
    if (typeof row.id !== 'string') return [];
    const id = row.id;
    const isHostManaged = id.startsWith(HOST_PROVIDER_PREFIX);
    const chat = typeof row.chat === 'string' ? row.chat : '';
    const responses = typeof row.responses === 'string' ? row.responses : '';
    const anthropic = typeof row.anthropic === 'string' ? row.anthropic : '';
    let api: MagpieProviderApi = 'openai-completions';
    let baseUrl = chat;
    if (anthropic) {
      api = 'anthropic-messages';
      baseUrl = anthropic;
    } else if (responses) {
      api = 'openai-responses';
      baseUrl = responses;
    }
    const models = providerModelIds(
      Array.isArray(row.models) ? row.models : Array.isArray(row.chosen) ? row.chosen : [],
    );
    const fallback = (Array.isArray(row.fallback) ? row.fallback : []).filter(
      (f): f is string => typeof f === 'string',
    );
    const hasKey = providerHasKey(row);
    return [
      {
        id,
        name: typeof row.name === 'string' ? row.name : id,
        api,
        baseUrl,
        chat: chat || undefined,
        responses: responses || undefined,
        anthropic: anthropic || undefined,
        models,
        off: row.off === true,
        isHostManaged,
        hasKey,
        keyMasked: providerKeyMasked(row, isHostManaged),
        fallback,
      },
    ];
  });
}
