import {
  classifyCoworkError,
  CoworkErrorKind,
  getUserErrorI18nKey,
} from '../../common/coworkError';
import { resolveCodingErrorTranslation } from '../../shared/codingAgent';
import { resolveWorkbenchErrorTranslation } from '../../shared/workbenchTask';
import { normalizeError, readErrorMessage } from './errorNormalization';
import { i18nService } from './i18n';

const DEFAULT_FALLBACK_KEY = 'codingAgentActionFailed';

/**
 * Resolve the text a surface should show for an error produced by the app.
 *
 * Order matters: the app's own messages are translated first (they are ours to
 * word), then the shared agent-error classification covers runtime and provider
 * failures, and only genuinely unknown text falls back to the generic
 * normalisation, which keeps a cleaned reason after a Chinese prefix.
 *
 * Third-party text is never invented: an unmapped git or ACP failure keeps its
 * cleaned reason instead of a fabricated sentence.
 */
export function appErrorText(error: unknown, fallbackKey = DEFAULT_FALLBACK_KEY): string {
  const message = readErrorMessage(error).trim();
  if (!message) return i18nService.t(fallbackKey);

  const appMessage = translateOwnMessage(message);
  if (appMessage) return appMessage;

  const classified = classifyCoworkError(message);
  if (classified.kind !== CoworkErrorKind.Unknown) {
    return i18nService.t(getUserErrorI18nKey(classified.kind));
  }
  return normalizeError(message);
}

/**
 * Translate and forward the raw detail to the application log. Use this at
 * event handlers; render paths use {@link appErrorText} so repeated renders do
 * not flood the log.
 */
export function reportAppError(
  error: unknown,
  fallbackKey = DEFAULT_FALLBACK_KEY,
  tag = 'Coding',
): string {
  const message = readErrorMessage(error).trim();
  if (message) {
    console.error(`[${tag}] ${message}`);
    // The bridge only exists in the Electron renderer; unit tests and any
    // non-window context must still be able to format the error.
    if (typeof window !== 'undefined') {
      window.electron?.log?.fromRenderer?.('error', tag, message);
    }
  }
  return appErrorText(error, fallbackKey);
}

function translateOwnMessage(message: string): string | null {
  const coding = resolveCodingErrorTranslation(message);
  if (coding) return formatTranslation(coding.key, coding.detail);

  const workbench = resolveWorkbenchErrorTranslation(message);
  if (workbench) return i18nService.t(workbench.key);

  return null;
}

function formatTranslation(key: string, detail?: string): string {
  const text = i18nService.t(key);
  // Only messages that advertise a placeholder keep the extracted detail; the
  // rest would otherwise append raw technical text after a complete sentence.
  if (!detail || !text.includes('{detail}')) return text;
  return text.replace('{detail}', detail);
}
