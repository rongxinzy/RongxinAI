/**
 * Pure platform state helpers for the IM settings view.
 *
 * Extracted from IMSettings.tsx (issue #1069). These functions must stay
 * behavior-identical to the closures they replace: same field access, same
 * optional chaining, same fallbacks.
 */
import type { Platform } from '@shared/platform';

import type { IMGatewayConfig, IMGatewayStatus } from '../../../types/im';

/** Platforms whose IM config is a list of instances managed in the settings UI. */
export type MultiInstancePlatform = 'dingtalk' | 'feishu' | 'qq' | 'wecom' | 'telegram' | 'discord';

const MULTI_INSTANCE_PLATFORMS: readonly MultiInstancePlatform[] = [
  'dingtalk',
  'feishu',
  'qq',
  'wecom',
  'telegram',
  'discord',
];

export const isMultiInstancePlatform = (platform: Platform): platform is MultiInstancePlatform =>
  MULTI_INSTANCE_PLATFORMS.includes(platform as MultiInstancePlatform);

/** Check if a platform has enough credentials to be started. */
export const canStartIMPlatform = (config: IMGatewayConfig, platform: Platform): boolean => {
  if (platform === 'dingtalk') {
    return config.dingtalk.instances.some(i => !!(i.clientId && i.clientSecret));
  }
  if (platform === 'telegram') {
    return config.telegram.instances.some(i => !!i.botToken);
  }
  if (platform === 'discord') {
    return config.discord.instances.some(i => !!i.botToken);
  }
  if (platform === 'qq') {
    return config.qq.instances.some(i => !!(i.appId && i.appSecret));
  }
  if (platform === 'wecom') {
    return config.wecom.instances.some(i => !!(i.botId && i.secret));
  }
  if (platform === 'weixin') {
    return true; // No credentials needed, connects via QR code in CLI
  }
  return config.feishu.instances?.some(i => !!(i.appId && i.appSecret));
};

/** Get platform enabled state (persisted toggle state). */
export const isIMPlatformEnabled = (config: IMGatewayConfig, platform: Platform): boolean => {
  if (platform === 'dingtalk') {
    return config.dingtalk.instances?.some(i => i.enabled);
  }
  if (platform === 'qq') {
    return config.qq.instances.some(i => i.enabled);
  }
  if (platform === 'feishu') {
    return config.feishu.instances?.some(i => i.enabled);
  }
  if (platform === 'wecom') {
    return config.wecom.instances?.some(i => i.enabled);
  }
  if (platform === 'telegram') {
    return config.telegram.instances?.some(i => i.enabled);
  }
  if (platform === 'discord') {
    return config.discord.instances?.some(i => i.enabled);
  }
  return (config[platform] as { enabled: boolean }).enabled;
};

/** Get platform connection status (runtime state). */
export const getIMPlatformConnected = (status: IMGatewayStatus, platform: Platform): boolean => {
  if (platform === 'dingtalk') return status.dingtalk?.instances?.some(i => i.connected) ?? false;
  if (platform === 'telegram') return status.telegram?.instances?.some(i => i.connected) ?? false;
  if (platform === 'discord') return status.discord?.instances?.some(i => i.connected) ?? false;
  if (platform === 'qq') return status.qq?.instances?.some(i => i.connected) ?? false;
  if (platform === 'wecom') return status.wecom?.instances?.some(i => i.connected) ?? false;
  if (platform === 'weixin') return status.weixin?.connected ?? false;
  return status.feishu?.instances?.some(i => i.connected) ?? false;
};

/** Get platform transient starting status. */
export const getIMPlatformStarting = (status: IMGatewayStatus, platform: Platform): boolean => {
  if (platform === 'discord') return status.discord.instances?.[0]?.starting ?? false;
  return false;
};

/** Minimal instance shape needed by the settings platform navigation. */
export interface IMNavInstance {
  instanceId: string;
  instanceName: string;
  enabled: boolean;
}

export interface IMNavInstanceStatus {
  instanceId: string;
  connected?: boolean;
}

export const getNavInstances = (
  config: IMGatewayConfig,
  platform: MultiInstancePlatform,
): IMNavInstance[] => {
  switch (platform) {
    case 'dingtalk':
      return config.dingtalk.instances;
    case 'feishu':
      return config.feishu.instances;
    case 'qq':
      return config.qq.instances;
    case 'wecom':
      return config.wecom.instances;
    case 'telegram':
      return config.telegram.instances;
    case 'discord':
      return config.discord.instances;
  }
};

export const getNavInstanceStatuses = (
  status: IMGatewayStatus,
  platform: MultiInstancePlatform,
): IMNavInstanceStatus[] | undefined => {
  switch (platform) {
    case 'dingtalk':
      return status.dingtalk?.instances;
    case 'feishu':
      return status.feishu?.instances;
    case 'qq':
      return status.qq?.instances;
    case 'wecom':
      return status.wecom?.instances;
    case 'telegram':
      return status.telegram?.instances;
    case 'discord':
      return status.discord?.instances;
  }
};
