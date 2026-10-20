import type {
  MagpieProviderApi,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
} from '../../shared/magpie/types';
import { HOST_PROVIDER_PREFIX } from './hostProviders';
import { maskApiKey } from './magpieManagerUtils';

const MAX_MODEL_ID_LENGTH = 500;
const MAX_MODEL_IDS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Model ids the user has exposed or explicitly picked in upstream state. */
export function projectSelectedProviderModelIds(row: Record<string, unknown>): string[] {
  const chosen = Array.isArray(row.chosen)
    ? row.chosen.filter(
        (id): id is string =>
          typeof id === 'string' && id.length > 0 && id.length <= MAX_MODEL_ID_LENGTH,
      )
    : [];
  if (chosen.length > 0) return chosen.slice(0, MAX_MODEL_IDS);

  const raw = row.models;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item: unknown) => {
      if (typeof item === 'string' && item.length > 0 && item.length <= MAX_MODEL_ID_LENGTH) {
        return [item];
      }
      if (!isRecord(item)) return [];
      if (item.on === false) return [];
      const id = item.id;
      return typeof id === 'string' && id.length > 0 && id.length <= MAX_MODEL_ID_LENGTH
        ? [id]
        : [];
    })
    .slice(0, MAX_MODEL_IDS);
}

function providerHasKey(raw: Record<string, unknown>): boolean {
  const key = raw.key;
  if (isRecord(key)) {
    // Mask('none') and a real four-character key both yield '••••'.
    // Summaries refine bullet-masked rows via stored-key lookup in MagpieManager.providers().
    return key.set === true;
  }
  if (typeof key === 'string') {
    return key.length > 0 && key !== 'magpie-local' && key !== 'none';
  }
  return false;
}

function providerKeyMasked(
  raw: Record<string, unknown>,
  isHostManaged: boolean,
): string | undefined {
  if (isHostManaged) return 'system-managed';
  const key = raw.key;
  if (isRecord(key)) {
    const masked = key.masked;
    if (typeof masked === 'string' && masked.length > 0 && masked.length <= 120) return masked;
    if (key.set === true) return '••••';
  }
  if (typeof key === 'string') return maskApiKey(key);
  return undefined;
}

/** Project upstream `/api/providers` rows to renderer-safe summaries. */
export function projectMagpieProviderSummaries(state: unknown): MagpieProviderSummary[] {
  const body = isRecord(state) ? state : {};
  const rawList = Array.isArray(body.providers) ? body.providers : [];
  return rawList.flatMap((p: unknown) => {
    if (!isRecord(p) || typeof p.id !== 'string') return [];
    const id = p.id;
    const isHostManaged = id.startsWith(HOST_PROVIDER_PREFIX);
    const chat = typeof p.chat === 'string' ? p.chat : '';
    const responses = typeof p.responses === 'string' ? p.responses : '';
    const anthropic = typeof p.anthropic === 'string' ? p.anthropic : '';
    let api: MagpieProviderApi = 'openai-completions';
    let baseUrl = chat;
    if (anthropic) {
      api = 'anthropic-messages';
      baseUrl = anthropic;
    } else if (responses) {
      api = 'openai-responses';
      baseUrl = responses;
    }
    const models = projectSelectedProviderModelIds(p);
    const fallback = (Array.isArray(p.fallback) ? p.fallback : []).filter(
      (f): f is string => typeof f === 'string',
    );
    const hasKey = providerHasKey(p);
    return [
      {
        id,
        name: typeof p.name === 'string' ? p.name : id,
        api,
        baseUrl,
        chat: chat || undefined,
        responses: responses || undefined,
        anthropic: anthropic || undefined,
        models,
        off: p.off === true,
        isHostManaged,
        hasKey,
        keyMasked: providerKeyMasked(p, isHostManaged),
        fallback,
      },
    ];
  });
}

/** Blank means keep the stored key on edit; probes also treat `none` as no key. */
export function resolveMagpieProviderSaveKey(inputKey?: string): string {
  const trimmed = inputKey?.trim();
  if (trimmed && trimmed !== 'none') return trimmed;
  return '';
}

export function buildMagpieProviderSavePayload(
  input: MagpieSaveProviderInput,
  existing: Record<string, unknown> | undefined,
  id: string,
  targetField: 'chat' | 'responses' | 'anthropic',
  baseUrl: string,
): Record<string, unknown> {
  const models = Array.isArray(input.models)
    ? input.models.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim())
    : [];
  const fallback = Array.isArray(input.fallback)
    ? input.fallback.filter(f => typeof f === 'string')
    : [];
  return {
    id,
    from: id,
    name: input.name.trim(),
    chat: '',
    responses: '',
    anthropic: '',
    [targetField]: baseUrl,
    // Without a NoKey preset, upstream requires a nonempty key for LAN endpoints.
    // Only creation needs this sentinel; blank edits must keep the stored secret.
    key: resolveMagpieProviderSaveKey(input.key) || (existing ? '' : 'none'),
    models,
    noModels: models.length === 0,
    fallback,
    proxy: 'direct',
    unredacted: true,
    off: existing ? existing.off === true : false,
    headers: {},
    extraBody: {},
    new: !existing,
  };
}
