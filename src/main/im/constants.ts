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
