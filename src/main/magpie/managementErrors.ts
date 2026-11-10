import { extractRuntimeErrorMessage } from '../../shared/magpie/runtimeErrorMessage';

/** Upstream management responses may embed the internal runtime name; user-facing errors stay neutral. */
export function neutralizeUpstreamBrand(text: string): string {
  return text.replace(/magpie/gi, 'local model service');
}

export function formatMagpieManagementError(
  status: number,
  statusText: string,
  text: string,
): string {
  const message = extractRuntimeErrorMessage(text);
  if (message !== text && message.trim()) return neutralizeUpstreamBrand(message.trim());
  if (text.length > 4096) return `HTTP ${status}: ${statusText}`;
  const trimmed = text.trim();
  if (trimmed && trimmed.length <= 500) return neutralizeUpstreamBrand(trimmed);
  return `HTTP ${status}: ${statusText}`;
}
