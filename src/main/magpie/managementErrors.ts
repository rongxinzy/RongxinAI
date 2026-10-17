export function formatMagpieManagementError(
  status: number,
  statusText: string,
  text: string,
): string {
  if (text.length > 4096) return `HTTP ${status}: ${statusText}`;
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  } catch {
    /* fall through */
  }
  const trimmed = text.trim();
  if (trimmed && trimmed.length <= 500) return trimmed;
  return `HTTP ${status}: ${statusText}`;
}
