import type { Platform } from '@shared/platform';

import dingtalkLogo from './im-logos/dingding.png';
import discordLogo from './im-logos/discord.svg';
import feishuLogo from './im-logos/feishu.png';
import qqLogo from './im-logos/qq_bot.jpeg';
import telegramLogo from './im-logos/telegram.svg';
import wecomLogo from './im-logos/wecom.png';
import weixinLogo from './im-logos/weixin.png';

// Bundled by vite so URLs resolve under dev server, file:// and custom protocols alike.
const IM_PLATFORM_LOGOS: Record<Platform, string> = {
  weixin: weixinLogo,
  dingtalk: dingtalkLogo,
  feishu: feishuLogo,
  wecom: wecomLogo,
  qq: qqLogo,
  telegram: telegramLogo,
  discord: discordLogo,
};

export function imPlatformLogo(platform: Platform): string {
  return IM_PLATFORM_LOGOS[platform];
}
