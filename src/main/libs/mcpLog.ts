export { looksLikeTransportErrorText, serializeForLog, truncateForLog } from './sanitizeForLog';

const LOG_PREVIEW_MAX_CHARS = 400;

import {
  serializeForLog as _serializeForLog,
  truncateForLog as _truncateForLog,
} from './sanitizeForLog';

export function serializeToolContentForLog(
  content: Array<{ type?: string; text?: string; [key: string]: unknown }>,
  maxChars = LOG_PREVIEW_MAX_CHARS,
): string {
  return _serializeForLog(content, maxChars);
}

export function getToolTextPreview(
  content: Array<{ type?: string; text?: string; [key: string]: unknown }>,
  maxChars = LOG_PREVIEW_MAX_CHARS,
): string {
  const text = content
    .map(block => (typeof block.text === 'string' ? block.text.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return _truncateForLog(text, maxChars);
}
