import type { MagpieTestProviderResult } from '../../../shared/magpie/types';
import { i18nService } from '../i18n';
import { neutralRuntimeName } from '../runtimeNameNeutralizer';

type ProviderErrorCode =
  | 'auth_invalid'
  | 'auth_forbidden'
  | 'html_endpoint'
  | 'not_found'
  | 'rate_limited'
  | 'insufficient_balance'
  | 'timeout'
  | 'dns'
  | 'refused'
  | 'tls'
  | 'server_error'
  | 'empty_models'
  | 'model_not_found'
  | 'context_overflow'
  | 'service_down'
  | 'unknown';

export type ProviderErrorAction =
  | 'reenter_key'
  | 'fix_v1'
  | 'expand_advanced'
  | 'open_network'
  | 'manual_models'
  | 'retry'
  | 'open_usage'
  | 'none';

export interface ClassifiedProviderError {
  code: ProviderErrorCode;
  title: string;
  hint: string;
  action: ProviderErrorAction;
  suggestedBaseUrl?: string;
  technicalDetail?: string;
}

const SECRET_PATTERN = /(bearer\s+|sk-[a-z0-9-]*|tp-[a-z0-9-]*|ttp-[a-z0-9-]*)[a-z0-9._-]+/gi;

export function maskSecretsInError(text: string): string {
  return neutralRuntimeName(text).replace(SECRET_PATTERN, '$1***');
}

export function appendV1ToBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  if (/\/v\d+(beta\d*)?(\/openai)?$/i.test(trimmed)) return undefined;
  return `${trimmed}/v1`;
}

function classifyCodeFromRaw(
  rawMessage: string,
  testResult?: Partial<MagpieTestProviderResult>,
): ProviderErrorCode {
  if (testResult?.requiresKey) return 'auth_invalid';
  if (testResult?.errorCode === 'html-endpoint') return 'html_endpoint';
  if (testResult?.errorCode === 'not-json') return 'html_endpoint';

  const msg = rawMessage.toLowerCase();
  if (/401|unauthorized|invalid[\s_-]?api[\s_-]?key|authentication|incorrect api key/.test(msg)) {
    return 'auth_invalid';
  }
  if (/403|forbidden|permission denied|not activated|实名/.test(msg)) {
    return 'auth_forbidden';
  }
  if (/402|insufficient|balance|余额不足|quota exceeded|out of credit/.test(msg)) {
    return 'insufficient_balance';
  }
  if (/429|rate[\s_-]?limit|too many requests/.test(msg)) {
    return 'rate_limited';
  }
  if (/404|not found|endpoint does not exist/.test(msg)) {
    return 'not_found';
  }
  if (/timeout|timed out|etimedout|aborted/.test(msg)) {
    return 'timeout';
  }
  if (/enotfound|getaddrinfo|dns/.test(msg)) {
    return 'dns';
  }
  if (/econnrefused|connection refused/.test(msg)) {
    return 'refused';
  }
  if (/certificate|self[- ]signed|ssl|tls|unable to verify/.test(msg)) {
    return 'tls';
  }
  if (/500|502|503|504|bad gateway|service unavailable|internal server error/.test(msg)) {
    return 'server_error';
  }
  if (/model[\s_-]?not[\s_-]?found|does not exist/.test(msg)) {
    return 'model_not_found';
  }
  if (/context[\s_-]?length|maximum context|token limit|too long/.test(msg)) {
    return 'context_overflow';
  }
  if (/not running|service stopped|failed to start/.test(msg)) {
    return 'service_down';
  }
  return 'unknown';
}

export function classifyProviderError(params: {
  raw?: string;
  testResult?: MagpieTestProviderResult;
  providerName?: string;
  baseUrl?: string;
}): ClassifiedProviderError {
  const { raw = '', testResult, providerName, baseUrl = '' } = params;
  const rawMessage = testResult?.error || raw || '';
  const code = classifyCodeFromRaw(rawMessage, testResult);
  const providerLabel =
    providerName?.trim() || (i18nService.getLanguage() === 'zh' ? '服务商' : 'the provider');
  const suggestedBaseUrl = code === 'html_endpoint' ? appendV1ToBaseUrl(baseUrl) : undefined;
  const technicalDetail = rawMessage ? maskSecretsInError(rawMessage) : undefined;

  const t = (key: string) =>
    i18nService
      .t(key)
      .replace(/\{provider\}/g, providerLabel)
      .replace(/\{url\}/g, baseUrl || '—');

  switch (code) {
    case 'auth_invalid':
      return {
        code,
        title: t('providerErrAuthInvalidTitle'),
        hint: t('providerErrAuthInvalidHint'),
        action: 'reenter_key',
        technicalDetail,
      };
    case 'auth_forbidden':
      return {
        code,
        title: t('providerErrAuthForbiddenTitle'),
        hint: t('providerErrAuthForbiddenHint'),
        action: 'reenter_key',
        technicalDetail,
      };
    case 'html_endpoint':
      return {
        code,
        title: t('providerErrHtmlTitle'),
        hint: t('providerErrHtmlHint'),
        action: suggestedBaseUrl ? 'fix_v1' : 'expand_advanced',
        suggestedBaseUrl,
        technicalDetail,
      };
    case 'not_found':
      return {
        code,
        title: t('providerErrNotFoundTitle'),
        hint: t('providerErrNotFoundHint'),
        action: 'expand_advanced',
        technicalDetail,
      };
    case 'rate_limited':
      return {
        code,
        title: t('providerErrRateLimitTitle'),
        hint: t('providerErrRateLimitHint'),
        action: 'open_usage',
        technicalDetail,
      };
    case 'insufficient_balance':
      return {
        code,
        title: t('providerErrBalanceTitle'),
        hint: t('providerErrBalanceHint'),
        action: 'none',
        technicalDetail,
      };
    case 'timeout':
      return {
        code,
        title: t('providerErrTimeoutTitle'),
        hint: t('providerErrTimeoutHint'),
        action: 'open_network',
        technicalDetail,
      };
    case 'dns':
      return {
        code,
        title: t('providerErrDnsTitle'),
        hint: t('providerErrDnsHint'),
        action: 'expand_advanced',
        technicalDetail,
      };
    case 'refused':
      return {
        code,
        title: t('providerErrRefusedTitle'),
        hint: t('providerErrRefusedHint'),
        action: 'retry',
        technicalDetail,
      };
    case 'tls':
      return {
        code,
        title: t('providerErrTlsTitle'),
        hint: t('providerErrTlsHint'),
        action: 'open_network',
        technicalDetail,
      };
    case 'server_error':
      return {
        code,
        title: t('providerErrServerTitle'),
        hint: t('providerErrServerHint'),
        action: 'retry',
        technicalDetail,
      };
    case 'model_not_found':
      return {
        code,
        title: t('providerErrModelMissingTitle'),
        hint: t('providerErrModelMissingHint'),
        action: 'manual_models',
        technicalDetail,
      };
    case 'context_overflow':
      return {
        code,
        title: t('providerErrContextTitle'),
        hint: t('providerErrContextHint'),
        action: 'none',
        technicalDetail,
      };
    case 'service_down':
      return {
        code,
        title: t('providerErrServiceDownTitle'),
        hint: t('providerErrServiceDownHint'),
        action: 'retry',
        technicalDetail,
      };
    default:
      return {
        code: 'unknown',
        title: t('providerErrUnknownTitle'),
        hint: t('providerErrUnknownHint'),
        action: 'retry',
        technicalDetail,
      };
  }
}
