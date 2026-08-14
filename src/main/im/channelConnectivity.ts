import { t } from '../i18n';
import type { CcConnectAccountRuntimeStatus } from '../libs/ccConnectRuntimeStatusRegistry';
import { ConnectivityCheckCode, ConnectivityCheckLevel } from './constants';
import type { IMConnectivityTestResult, IMGatewayConfig, Platform } from './types';

type ChannelInstance = { instanceId: string; enabled: boolean };

export function selectConnectivityInstance<T extends ChannelInstance>(
  instances: T[],
  requestedAccountId?: string,
): T | undefined {
  const requested = requestedAccountId?.trim();
  return requested
    ? instances.find(item => item.instanceId === requested)
    : (instances.find(item => item.enabled) ?? instances[0]);
}

export function resolveFeishuAuthEndpoint(domain: string): string {
  const service = domain.trim();
  if (!service || service.toLowerCase() === 'feishu') {
    return 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
  }
  if (service.toLowerCase() === 'lark') {
    return 'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal';
  }

  const baseUrl = new URL(service);
  if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') {
    throw new Error('Feishu service domain must use HTTP or HTTPS.');
  }
  return new URL('/open-apis/auth/v3/tenant_access_token/internal', baseUrl).toString();
}

export function resolveConnectivityAccount(
  platform: Platform,
  config: IMGatewayConfig,
  requestedAccountId?: string,
): { accountId: string | null; enabled: boolean } {
  if (platform === 'weixin') {
    const accountId = config.weixin.accountId.trim();
    return { accountId: accountId || null, enabled: config.weixin.enabled };
  }

  const instances = config[platform].instances as ChannelInstance[];
  const requested = requestedAccountId?.trim();
  const instance = selectConnectivityInstance(instances, requested);
  return {
    accountId: instance?.instanceId ?? requested ?? null,
    enabled: instance?.enabled ?? false,
  };
}

export function appendRuntimeConnectivity(
  result: IMConnectivityTestResult,
  account: { accountId: string | null; enabled: boolean },
  runtimeStatus: CcConnectAccountRuntimeStatus | null,
  runtimeError?: unknown,
): IMConnectivityTestResult {
  const checks = [...result.checks];
  if (!account.enabled) {
    checks.push({
      code: ConnectivityCheckCode.RuntimeUnavailable,
      level: ConnectivityCheckLevel.Info,
      message: t('imChannelNotEnabled'),
      suggestion: t('imChannelNotEnabledSuggestion'),
    });
  } else if (runtimeStatus?.connected) {
    checks.push({
      code: ConnectivityCheckCode.RuntimeReady,
      level: ConnectivityCheckLevel.Pass,
      message: t('imChannelRunning'),
    });
  } else {
    const detail =
      runtimeError instanceof Error
        ? runtimeError.message
        : runtimeStatus?.lastError || (runtimeError ? String(runtimeError) : null);
    checks.push({
      code: ConnectivityCheckCode.RuntimeUnavailable,
      level: ConnectivityCheckLevel.Fail,
      message: detail
        ? `${t('imChannelEnabledNotConnected')} ${detail}`
        : t('imChannelEnabledNotConnected'),
      suggestion: t('imChannelEnabledNotConnectedSuggestion'),
    });
  }
  return {
    ...result,
    verdict: checks.some(check => check.level === ConnectivityCheckLevel.Fail)
      ? ConnectivityCheckLevel.Fail
      : !account.enabled && result.verdict === ConnectivityCheckLevel.Pass
        ? ConnectivityCheckLevel.Warn
        : result.verdict,
    checks,
  };
}
