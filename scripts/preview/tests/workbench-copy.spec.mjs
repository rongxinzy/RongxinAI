import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';
import { AppUpdateChannelPreference } from '../../../src/shared/appUpdate/constants.ts';

test.use({ actionTimeout: 15_000 });

async function openWorkbench(page, language, theme) {
  await page.addInitScript(
    ({ language, theme, stableChannel }) => {
      let api;
      Object.defineProperty(window, 'electron', {
        configurable: true,
        get: () => api,
        set(value) {
          let channel = stableChannel;
          value.appUpdate.getChannel = async () => channel;
          value.appUpdate.setChannel = async next => (channel = next);
          const updateState = value.appUpdate.getState;
          value.appUpdate.getState = async () => ({
            ...(await updateState()),
            info: null,
            progress: null,
            lastCheckedAt: null,
            lastInstallResult: null,
          });
          value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
          const get = value.store.get;
          value.store.get = async key =>
            key === 'app_config'
              ? { ...(await get(key)), language, theme: 'system', language_initialized: true }
              : get(key);
          const enrich = messages =>
            messages.map(message =>
              message.type === 'assistant'
                ? {
                    ...message,
                    metadata: {
                      ...message.metadata,
                      usage: {
                        inputTokens: 100,
                        outputTokens: 30,
                        cacheReadTokens: 20,
                        cacheWriteTokens: 0,
                      },
                      metrics: {
                        requestStartedAt: 1000,
                        firstVisibleTextAt: 1400,
                        completedAt: 3000,
                      },
                    },
                  }
                : message,
            );
          const session = value.cowork.getSession;
          value.cowork.getSession = async id => {
            const result = await session(id);
            if (result.session) result.session.messages = enrich(result.session.messages);
            return result;
          };
          const messages = value.cowork.getSessionMessages;
          value.cowork.getSessionMessages = async request => {
            const result = await messages(request);
            return { ...result, messages: enrich(result.messages) };
          };
          api = value;
        },
      });
    },
    { language, theme, stableChannel: AppUpdateChannelPreference.Stable },
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto('/?previewSkipBoot=1');
  await expect(page).toHaveTitle('ZhiYuan Agent');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-new-conversation')).toBeVisible();
  await page.getByText('Build a React calculator app', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Build a React calculator app' })).toBeVisible();
}

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark'])
    test(`workbench details preserve metrics, draft and keyboard access in ${language} ${theme}`, async ({
      page,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion copy');
      await openWorkbench(page, language, theme);
      const title = language === 'zh' ? '运行信息' : 'Run details';
      const trigger = page.getByRole('button', { name: title, exact: true });
      const popup = page.getByTestId('session-run-info');
      const input = page.getByRole('textbox').last();
      await input.fill('Keep my workbench draft');
      await trigger.focus();
      await trigger.press('Enter');
      await expect(popup).toBeVisible();
      await expect(popup.locator('dt')).toHaveCount(8);
      await expect(popup.locator('dd')).toHaveText([
        '1',
        '1',
        '2s',
        '400ms',
        '18.8 tok/s',
        '17%',
        '100',
        '30',
      ]);
      const accessibility = await new AxeBuilder({ page })
        .include('[data-testid="session-run-info"]')
        .analyze();
      expect(accessibility.violations.map(item => item.id)).toEqual([]);
      const before = await popup.evaluate(element => getComputedStyle(element).backgroundColor);
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await expect(popup).toBeVisible();
      await expect
        .poll(() => popup.evaluate(element => getComputedStyle(element).backgroundColor))
        .not.toBe(before);
      await expect(input).toHaveText('Keep my workbench draft');
      await page.emulateMedia({ colorScheme: theme });
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
        [940, 700],
        [760, 700],
      ]) {
        await page.setViewportSize({ width, height });
        await expect(popup).toBeVisible();
        await expect
          .poll(async () => {
            const bounds = await popup.boundingBox();
            return (
              bounds &&
              bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.x + bounds.width <= width &&
              bounds.y + bounds.height <= height
            );
          })
          .toBe(true);
        const bounds = await popup.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
        expect(await popup.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.screenshot({ path: `/tmp/companion-copy-${language}-${theme}-narrow.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `/tmp/companion-copy-${language}-${theme}-details.png` });
      await page.keyboard.press('Escape');
      await expect(popup).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await input.focus();
      await expect(input).toHaveText('Keep my workbench draft');
      await page.screenshot({ path: `/tmp/companion-copy-${language}-${theme}-workbench.png` });
      expect(failures).toEqual([]);
    });

for (const language of ['zh', 'en'])
  test(`settings describe actual approval, background and update behavior in ${language}`, async ({
    page,
  }) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'settings copy');
    await openWorkbench(page, language, 'light');
    const strings =
      language === 'zh'
        ? {
            login: '登录',
            settings: '设置',
            sleep: '后台运行时防止自动休眠',
            about: '关于',
            beta: '接收测试版更新',
            title: '你的智能伙伴',
          }
        : {
            login: 'Login',
            settings: 'Settings',
            sleep: 'Prevent automatic sleep while running',
            about: 'About',
            beta: 'Receive beta updates',
            title: 'Your intelligent companion',
          };
    await page.getByText(strings.login, { exact: true }).first().click();
    await page.getByRole('menuitem', { name: strings.settings, exact: true }).click();
    const sleep = page.getByRole('switch', { name: strings.sleep, exact: true });
    await expect(sleep).toBeVisible();
    await sleep.click();
    await expect(sleep).toBeChecked();
    await page.screenshot({ path: `/tmp/companion-copy-${language}-general.png` });
    await page.getByRole('button', { name: strings.about, exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: strings.about, exact: true })
        .getByText(strings.title, { exact: true }),
    ).toBeVisible();
    const beta = page.getByRole('switch', { name: strings.beta, exact: true });
    await expect(beta).not.toBeChecked();
    await beta.click();
    await expect(beta).toBeChecked();
    expect(await page.evaluate(() => window.electron.appUpdate.getChannel())).toBe(
      AppUpdateChannelPreference.Beta,
    );
    await beta.click();
    await expect(beta).not.toBeChecked();
    expect(await page.evaluate(() => window.electron.appUpdate.getChannel())).toBe(
      AppUpdateChannelPreference.Stable,
    );
    await page.screenshot({ path: `/tmp/companion-copy-${language}-about.png` });
    expect(failures).toEqual([]);
  });
