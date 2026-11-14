import { expect, test } from '@playwright/test';
import { attachConsoleGuards } from '../shared/harness.mjs';

for (const language of ['zh', 'en']) {
  for (const theme of ['light', 'dark']) {
    test(`accepted inputs stay read-only in ${language} ${theme}`, async ({ page }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'native queue');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(
        ({ language }) => {
          let api;
          Object.defineProperty(window, 'electron', {
            configurable: true,
            get: () => api,
            set(value) {
              const get = value.store.get;
              value.store.get = async key =>
                key === 'app_config'
                  ? { ...(await get(key)), language, theme: 'system', language_initialized: true }
                  : get(key);
              value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
              value.cowork.listPendingMessages = async () => ({
                success: true,
                items: [
                  {
                    id: 'accepted-1',
                    text: '继续读取下一篇文档 / Read the next document',
                    delivery: 'followUp',
                    status: 'pending',
                    createdAt: 1,
                  },
                  {
                    id: 'accepted-2',
                    text: '带有很长名称的图片输入 / An image input with a very long name '.repeat(
                      8,
                    ),
                    delivery: 'followUp',
                    status: 'pending',
                    createdAt: 2,
                  },
                  {
                    id: 'sending',
                    text: '正在投递的输入 / Sending input',
                    delivery: 'followUp',
                    status: 'sending',
                    createdAt: 3,
                  },
                  {
                    id: 'failed',
                    text: '投递失败的输入 / Failed input',
                    delivery: 'followUp',
                    status: 'failed',
                    error: 'Provider unavailable',
                    createdAt: 4,
                  },
                ],
              });
              api = value;
            },
          });
        },
        { language },
      );
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/?previewSkipBoot=1');
      await expect(page).toHaveTitle('ZhiYuan Agent');
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await page.getByText('Build a React calculator app', { exact: true }).first().click();
      const list = page.getByRole('list', {
        name: language === 'zh' ? '已排队的输入' : 'Queued inputs',
      });
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(list.getByRole('button')).toHaveCount(0);
      await expect(list.getByRole('textbox')).toHaveCount(0);
      const input = page.getByRole('textbox').last();
      await input.fill('Preserve this draft');
      await input.focus();
      const selection = await input.evaluate(() => ({
        anchor: getSelection()?.anchorOffset,
        focus: getSelection()?.focusOffset,
      }));
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await expect(input).toHaveText('Preserve this draft');
      await expect(input).toBeFocused();
      expect(
        await input.evaluate(() => ({
          anchor: getSelection()?.anchorOffset,
          focus: getSelection()?.focusOffset,
        })),
      ).toEqual(selection);
      await page.emulateMedia({ colorScheme: theme });
      const row = list.getByRole('listitem').first();
      await expect
        .poll(() => row.evaluate(element => getComputedStyle(element).minHeight))
        .toBe('32px');
      await page.screenshot({ path: `/tmp/pi-first-queue-${language}-${theme}.png` });
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
        { width: 940, height: 700 },
        { width: 760, height: 700 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(list).toBeVisible();
        expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        expect(
          await list.evaluate(element => element.getBoundingClientRect().right <= innerWidth),
        ).toBe(true);
        await expect(input).toHaveText('Preserve this draft');
      }
      await page.screenshot({ path: `/tmp/pi-first-queue-${language}-${theme}-narrow.png` });
      expect(failures).toEqual([]);
    });
  }
}
