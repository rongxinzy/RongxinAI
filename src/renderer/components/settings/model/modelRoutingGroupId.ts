/** Slug for upstream group id; non-Latin names get a stable random fallback. */
export function routingGroupIdFromName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (slug) return slug;
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `group-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
