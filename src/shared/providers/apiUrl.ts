export function buildAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/messages';
  if (normalized.endsWith('/v1/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}
/** Canonical persisted endpoint; connection signatures must use the same form. */
export function normalizeProviderBaseUrl(providerKey: string, baseUrl: unknown): string {
  if (typeof baseUrl !== 'string') return '';
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (providerKey !== 'gemini') return normalized;
  if (!normalized || !normalized.includes('generativelanguage.googleapis.com')) return normalized;
  if (normalized.endsWith('/v1beta/openai')) return normalized.slice(0, -'/openai'.length);
  if (normalized.endsWith('/v1/openai'))
    return `${normalized.slice(0, -'/v1/openai'.length)}/v1beta`;
  if (normalized.endsWith('/v1beta')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized.slice(0, -3)}/v1beta`;
  return 'https://generativelanguage.googleapis.com/v1beta';
}
