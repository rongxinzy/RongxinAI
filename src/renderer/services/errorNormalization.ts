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

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
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
  const message = rawMessage(error);
  const operationPrefix = i18nService.t('operationFailed');
  if (message === operationPrefix || message.startsWith(`${operationPrefix}：`) || message.startsWith(`${operationPrefix}:`)) {
    return message;
  }
  
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



