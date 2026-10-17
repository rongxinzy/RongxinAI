export const ConnectivityCheckCode = {
  Auth: 'auth_check',
  RuntimeReady: 'gateway_running',
  RuntimeUnavailable: 'channel_runtime_not_running',
} as const;

export const ConnectivityCheckLevel = {
  Pass: 'pass',
  Info: 'info',
  Warn: 'warn',
  Fail: 'fail',
} as const;

const DingTalkRegistrationEnvKey = 'DINGTALK_REGISTRATION_SOURCE';

/** Default `source` for DingTalk `/app/registration/init` (override via env). */
export function resolveDingTalkRegistrationSource(): string {
  const fromEnv = process.env[DingTalkRegistrationEnvKey]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'zhiyuan-agent';
}
