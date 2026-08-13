import type { IMGatewayConfig, WeixinChannelConfig } from './types';

export type IMGatewayConfigPatch = Omit<Partial<IMGatewayConfig>, 'weixin'> & {
  weixin?: Partial<WeixinChannelConfig>;
};

/** Keep QR-login identity owned by the main process, not renderer form state. */
export function sanitizeRendererIMConfigPatch(
  config: IMGatewayConfigPatch,
): IMGatewayConfigPatch {
  if (!config.weixin) return config;

  const {
    accountId,
    token,
    baseUrl,
    enabled,
    ...settings
  } = config.weixin;
  const containsLoginSnapshot =
    accountId !== undefined || token !== undefined || baseUrl !== undefined;

  return {
    ...config,
    weixin: containsLoginSnapshot ? settings : { enabled, ...settings },
  };
}
