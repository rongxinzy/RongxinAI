import type { MagpieModel } from '../../shared/magpie/types';

const ENDPOINTS = new Set(['/v1/chat/completions', '/v1/responses', '/v1/messages']);
const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000
    ? value
    : undefined;
const strings = (value: unknown, limit = 20): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.length <= 100).slice(0, limit)
    : [];

/** Explicitly project public catalog fields. Never spread an upstream record into renderer IPC. */
export function projectMagpieCatalog(body: unknown): MagpieModel[] {
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data))
    throw new Error('Invalid model catalog');
  if (body.data.length > 10_000) throw new Error('Model catalog exceeds model limit');
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
    return [
      {
        id: m.id,
        ...(typeof m.owned_by === 'string' && m.owned_by.length <= 200
          ? { owned_by: m.owned_by }
          : {}),
        ...(typeof m.display_name === 'string' && m.display_name.length <= 500
          ? { display_name: m.display_name }
          : {}),
        reasoning: m.reasoning === true || levels.length > 0,
        supported_reasoning_levels: levels,
        native_endpoints: strings(m.native_endpoints).filter(endpoint => ENDPOINTS.has(endpoint)),
        ...(positive(m.context_window) ? { context_window: positive(m.context_window) } : {}),
        ...(positive(m.max_output_tokens)
          ? { max_output_tokens: positive(m.max_output_tokens) }
          : {}),
        modalities: { input: strings(modalities.input), output },
      },
    ];
  });
}
