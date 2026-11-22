import { MAX_CONTEXT_TOKENS } from '../../shared/magpie/contexts';
import type { MagpieModel } from '../../shared/magpie/types';
import { ModelCapabilityStatus } from '../../shared/providers';

export function magpieImageInput(model: MagpieModel): ModelCapabilityStatus {
  if (!model.modalities) return ModelCapabilityStatus.Unknown;
  return model.modalities.input.includes('image')
    ? ModelCapabilityStatus.Supported
    : ModelCapabilityStatus.Unsupported;
}

export const MAGPIE_CONVERSATION_ENDPOINTS: ReadonlySet<string> = new Set([
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
]);

export function supportsMagpieTextConversation(model: MagpieModel): boolean {
  const { modalities, native_endpoints: endpoints } = model;
  // Empty catalog capability arrays leave text support unknown.
  return (
    (!modalities?.input.length || modalities.input.includes('text')) &&
    (!modalities?.output.length || modalities.output.includes('text')) &&
    (!endpoints?.length || endpoints.some(endpoint => MAGPIE_CONVERSATION_ENDPOINTS.has(endpoint)))
  );
}

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= MAX_CONTEXT_TOKENS
    ? value
    : undefined;
const strings = (value: unknown, limit = 20): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.length <= 100).slice(0, limit)
    : [];

function catalogRowMetadata({ id: _id, ...metadata }: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

function isBareCatalogRow(item: unknown): item is { id: string } {
  return (
    !!item &&
    typeof item === 'object' &&
    'id' in item &&
    typeof item.id === 'string' &&
    !item.id.includes('/')
  );
}

/** Explicitly project public catalog fields. Never spread an upstream record into renderer IPC. */
export function projectMagpieCatalog(body: unknown): MagpieModel[] {
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data))
    throw new Error('Invalid model catalog');
  if (body.data.length > 10_000) throw new Error('Model catalog exceeds model limit');
  // Magpie appends bare IDs after the qualified catalog and changes only the row ID.
  // shortcut: identical rows stay unresolved, use canonical IDs if Magpie exposes them.
  const firstBareIndex = body.data.findIndex(isBareCatalogRow);
  const canonicalIdsByMetadata = new Map<string, string | null>();
  if (firstBareIndex >= 0) {
    for (const item of body.data.slice(0, firstBareIndex)) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
      const key = catalogRowMetadata(item);
      canonicalIdsByMetadata.set(key, canonicalIdsByMetadata.has(key) ? null : item.id);
    }
  }
  const ids = new Set<string>();
  return body.data.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const m = item as Record<string, unknown>;
    if (
      typeof m.id !== 'string' ||
      !m.id.trim() ||
      m.id.length > 500 ||
      /[\u0000-\u001f]/.test(m.id)
    )
      return [];
    if (ids.has(m.id)) throw new Error('Duplicate model in catalog');
    ids.add(m.id);
    if (m.kind === 'image' || m.kind === 'video') return [];
    const modalities =
      m.modalities && typeof m.modalities === 'object'
        ? (m.modalities as Record<string, unknown>)
        : {};
    const output = strings(modalities.output);
    if (output.length && !output.includes('text')) return [];
    const endpoints = strings(m.native_endpoints);
    const conversationEndpoints = endpoints.filter(endpoint =>
      MAGPIE_CONVERSATION_ENDPOINTS.has(endpoint),
    );
    if (endpoints.length && !conversationEndpoints.length) return [];
    const levels = Array.isArray(m.supported_reasoning_levels)
      ? m.supported_reasoning_levels
          .flatMap((v: unknown) => {
            if (!v || typeof v !== 'object' || !('effort' in v)) return [];
            return typeof v.effort === 'string' && v.effort.length <= 30
              ? [{ effort: v.effort }]
              : [];
          })
          .slice(0, 20)
      : [];
    const canonicalId = isBareCatalogRow(m)
      ? canonicalIdsByMetadata.get(catalogRowMetadata(m))
      : undefined;
    return [
      {
        id: m.id,
        ...(canonicalId && canonicalId.length <= 500 && !/[\u0000-\u001f]/.test(canonicalId)
          ? { canonical_id: canonicalId }
          : {}),
        ...(typeof m.owned_by === 'string' && m.owned_by.length <= 200
          ? { owned_by: m.owned_by }
          : {}),
        ...(typeof m.display_name === 'string' && m.display_name.length <= 500
          ? { display_name: m.display_name }
          : {}),
        reasoning: m.reasoning === true || levels.length > 0,
        supported_reasoning_levels: levels,
        native_endpoints: conversationEndpoints,
        ...(positive(m.context_window) ? { context_window: positive(m.context_window) } : {}),
        ...(positive(m.max_output_tokens)
          ? { max_output_tokens: positive(m.max_output_tokens) }
          : {}),
        modalities: { input: strings(modalities.input), output },
      },
    ];
  });
}
