import { afterEach, expect, test } from 'vitest';
import { i18nService } from './i18n';
import { magpieTranslations } from './magpieTranslations';

afterEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

test('model service copy does not name the internal runtime', () => {
  expect(Object.keys(magpieTranslations.zh).sort()).toEqual(
    Object.keys(magpieTranslations.en).sort(),
  );
  for (const language of ['zh', 'en'] as const) {
    i18nService.setLanguage(language, { persist: false });
    for (const [key, value] of Object.entries(magpieTranslations[language])) {
      expect(value, `${language}.${key}`).not.toMatch(/magpie|喜鹊/i);
      expect(i18nService.t(key)).toBe(value);
    }
  }
  expect(magpieTranslations.zh.magpieSubscriptionsHint).toBe(
    '订阅账号由官方管理界面维护，凭据不会返回应用页面。',
  );
  expect(magpieTranslations.zh.magpieCatalogConsent).toBe(
    '启用会启动模型服务，并读取及自动同步已连接的本机 Agent 配置。订阅账号需单独启用，遥测与局域网访问关闭。',
  );
  expect(magpieTranslations.zh.magpieManagerDescription).toBe(
    '通过独立的模型服务管理本机 Agent 模型配置。',
  );
  expect(magpieTranslations.zh.magpieActivationNotice).toBe(
    '启用后，模型服务会读取并自动同步本机 Agent 配置。刷新管理状态也可能同步配置；选择模型后需点击“应用到 CLI”写入。',
  );
  expect(magpieTranslations.zh.magpieApplyNotice).toBe(
    '应用会通过模型服务修改对应 Agent 的模型配置。请在该 Agent 中开启新会话以使用新配置。',
  );
  expect(magpieTranslations.en.magpieSubscriptionsHint).toBe(
    'Manage subscription accounts in the official management UI. Credentials are not returned to this app page.',
  );
  expect(magpieTranslations.en.magpieCatalogConsent).toBe(
    'Enabling starts the model service and reads and automatically synchronizes connected local Agent configuration. Subscription accounts require separate opt-in. Telemetry and LAN access are disabled.',
  );
  expect(magpieTranslations.en.magpieManagerDescription).toBe(
    'Manage local Agent model configuration through the standalone model service.',
  );
  expect(magpieTranslations.en.magpieActivationNotice).toBe(
    'Enabling the model service reads and automatically synchronizes local Agent configuration. Refreshing management state may also synchronize configuration. A model selection made here is submitted when you click Apply to CLI.',
  );
  expect(magpieTranslations.en.magpieApplyNotice).toBe(
    'Applying uses the model service to change this Agent’s model configuration. Start a new session in that Agent to use it.',
  );
  expect(magpieTranslations.zh.magpieLicenseNotice).toBe('MIT · © 2026 yetone');
  expect(magpieTranslations.en.magpieLicenseNotice).toBe('MIT · © 2026 yetone');
});
