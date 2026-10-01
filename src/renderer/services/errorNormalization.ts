import { CoworkErrorKind, getUserErrorI18nKey } from '../../common/coworkError';
import { CodingErrorTranslationKeys } from '../../shared/codingAgent';
import { WorkbenchErrorI18nKey } from '../../shared/workbenchTask';
import { i18nService } from './i18n';

export const TOAST_DEFAULT_DURATION_MS = 2200;
export const TOAST_MAX_DURATION_MS = 3000;

const CATEGORY_KEYS = {
  network: 'networkError',
  auth: 'authenticationExpired',
  apiKey: 'apiKeyMissing',
  model: 'modelNotFound',
  timeout: 'requestTimeout',
  permission: 'permissionDenied',
  file: 'fileNotFound',
  git: 'gitConflict',
  mcp: 'mcpEndpointInvalid',
} as const;

const patterns: Array<[keyof typeof CATEGORY_KEYS, RegExp]> = [
  ['auth', /\b(401|unauthori[sz]ed|token expired|authentication expired)\b/i],
  ['apiKey', /api\s*key.{0,20}(missing|required|invalid)|missing.{0,20}api\s*key/i],
  ['model', /model.{0,20}(not found|does not exist|unknown)/i],
  ['timeout', /\b(timeout|timed out|etimedout|deadline exceeded)\b/i],
  ['permission', /\b(403|forbidden|permission denied|access denied)\b/i],
  ['file', /(enoent|file|path).{0,30}(not found|does not exist)|no such file/i],
  ['git', /git.{0,30}(conflict|merge conflict)|would be overwritten by merge/i],
  ['mcp', /mcp.{0,30}(endpoint|url).{0,20}(invalid|malformed)|invalid mcp endpoint/i],
  ['network', /network error|failed to fetch|fetch failed|econnrefused|enotfound|offline/i],
];

/** Extract the raw message from anything that was thrown or returned. */
export function readErrorMessage(error: unknown): string {
  if (error === null || error === undefined) return '';
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

const APP_COPY_KEYS = [
  ...new Set([
    ...CodingErrorTranslationKeys,
    ...Object.values(WorkbenchErrorI18nKey),
    ...Object.values(CoworkErrorKind).map(getUserErrorI18nKey),
    ...Object.values(CATEGORY_KEYS),
    // Copy `appErrorText` returns when the caller has no error to translate:
    // the isError toast consumer would otherwise prefix 操作失败 a second time.
    'operationFailed',
    'runtimeRetryNotice',
    'codingAgentActionFailed',
    'codingAgentTurnFailed',
    'codingAgentTurnCancelled',
    'codingGitActionFailed',
    'codingSessionCreateFailed',
    'codingAgentFilesPreviewUnavailable',
    'coworkQueueUpdateFailed',
    'coworkQueueDeleteFailed',
    'coworkQueueSteerFailed',
    'coworkQueueRetryFailed',
  ]),
];

/**
 * Whether the text is error copy this app produced, in the active language.
 *
 * Toasts dispatch through {@link normalizeError} a second time, so our own
 * sentences — already translated by the catalog — must survive unchanged
 * instead of being wrapped a second time ("操作失败：加载待发送消息失败。").
 * Templates with a `{detail}` placeholder are compared on their fixed head.
 */
export function isLocalizedAppErrorText(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return APP_COPY_KEYS.some(key => {
    const [head] = i18nService.t(key).split('{');
    return head.trim().length > 1 && trimmed.startsWith(head.trim());
  });
}

export function cleanErrorReason(input: string): string {
  let value = input.replace(/<[^>]*>/g, ' ').replace(/```[\s\S]*?```/g, ' ');
  value = value.replace(/https?:\/\/[^\s)]+/gi, '[URL]');
  value = value.replace(/[A-Za-z]:\\[^\s)]+|\/(?:[^\s/]+\/)+[^\s)]+/g, '[path]');
  value = value.replace(/\{[\s\S]*\}|\[[\s\S]*\]/g, ' ');
  value = value.split(/\n\s*at\s|\nTraceback|\nError:/i)[0];
  value = value.replace(/\s+/g, ' ').replace(/[\s.;:,]+$/, '').trim();
  if (!value || value.length < 2 || /^(error|exception|failed)$/i.test(value)) return '';
  return value.slice(0, 140);
}

export function normalizeError(error: unknown): string {
  const message = readErrorMessage(error);
  const operationPrefix = i18nService.t('operationFailed');
  if (message === operationPrefix || message.startsWith(`${operationPrefix}：`) || message.startsWith(`${operationPrefix}:`)) {
    return message;
  }
  if (isLocalizedAppErrorText(message)) return message;
  
  const category = patterns.find(([, pattern]) => pattern.test(message))?.[0];
  if (category) {
    return i18nService.t(CATEGORY_KEYS[category]);
  }
  const reason = cleanErrorReason(message);
  if (!reason) return i18nService.t('operationFailed');
  return i18nService.getLanguage() === 'zh' ? `${i18nService.t('operationFailed')}：${reason}` : `${i18nService.t('operationFailed')}: ${reason}`;
}

export function reportError(error: unknown): string {
  console.error('[ErrorNormalization] operation failed:', error);
  return normalizeError(error);
}



