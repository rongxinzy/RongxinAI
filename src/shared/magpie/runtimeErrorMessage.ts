/**
 * Message inside a runtime error the renderer may receive whole or cut off
 * mid-JSON. The stored text stays unchanged; callers only read this.
 */
export function extractRuntimeErrorMessage(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const fromParsed = messageOf(parsed);
  if (fromParsed) return fromParsed;
  const quoted = /message"?\s*:\s*"((?:\\.|[^"\\])*)"/.exec(text);
  if (quoted) {
    try {
      const decoded: unknown = JSON.parse(`"${quoted[1]}"`);
      if (typeof decoded === 'string') return decoded;
    } catch {
      return quoted[1];
    }
  }
  return text;
}

function messageOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if ('message' in value && typeof value.message === 'string' && value.message.trim()) {
    return value.message;
  }
  if ('error' in value) {
    const error = value.error;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object' && 'message' in error) {
      return typeof error.message === 'string' && error.message.trim() ? error.message : undefined;
    }
  }
  return undefined;
}
