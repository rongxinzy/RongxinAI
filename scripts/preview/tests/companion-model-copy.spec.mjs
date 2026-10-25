import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';
import { magpieTranslations } from '../../../src/renderer/services/magpieTranslations.ts';

async function settledTheme(page, region, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
  // Check the painted Quiet Studio surface as well as the appearance class.
  await expect
    .poll(() =>
      region.evaluate(element => {
        // Settings uses a transparent canvas over the shell panel.
        for (let surface = element; surface; surface = surface.parentElement) {
          const color = getComputedStyle(surface).backgroundColor;
          if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
        }
        return null;
      }),
    )
    .toBe(theme === 'dark' ? 'rgb(24, 25, 29)' : 'rgb(255, 255, 255)');
}

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark'])
    test(`model settings keep consent and actual entry names in ${language} ${theme}`, async ({
      page,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion model copy');
      const copy = magpieTranslations[language];
      await page.addInitScript(
        ({ language }) => {
          let api;
          Object.defineProperty(window, 'electron', {
            configurable: true,
            get: () => api,
            set(value) {
              let enabled = false;
              window.modelCopyStarts = 0;
              const catalog = value.magpie.catalog;
              value.magpie.catalog = async () =>
                enabled
                  ? catalog()
                  : {
                      status: { state: 'stopped', version: 'preview', enabled: false },
                      models: [],
                      defaultModelId: null,
                    };
              const status = value.magpie.status;
              value.magpie.status = async () =>
                enabled ? status() : { state: 'stopped', version: 'preview', enabled: false };
              value.magpie.start = async () => {
                window.modelCopyStarts++;
                enabled = true;
                return status();
              };
              value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
              const get = value.store.get;
              value.store.get = async key =>
                key === 'app_config'
                  ? { ...(await get(key)), language, theme: 'system', language_initialized: true }
                  : get(key);
              api = value;
            },
          });
        },
        { language },
      );
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/?previewSkipBoot=1');
      await page
        .getByText(language === 'zh' ? '登录' : 'Login', { exact: true })
        .first()
        .click();
      await page
        .getByRole('menuitem', { name: language === 'zh' ? '设置' : 'Settings', exact: true })
        .click();
      const modelLabel = language === 'zh' ? '模型' : 'Model';
      await page.getByRole('button', { name: modelLabel, exact: true }).click();
      const region = page.getByRole('region', { name: modelLabel, exact: true });
      await settledTheme(page, region, theme);
      await expect(region.getByText(copy.magpieCatalogConsent, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.modelCopyStarts)).toBe(0);
      await region.getByRole('tab', { name: copy.magpieSectionAdvanced, exact: true }).click();
      await expect(region.getByText(copy.magpieServiceRequired, { exact: true })).toBeVisible();
      await region
        .getByRole('tab', { name: copy.magpieSectionProvidersAndModels, exact: true })
        .click();
      await region.getByRole('button', { name: copy.magpieCatalogEnable, exact: true }).click();
      const search = region.getByRole('searchbox');
      await expect(search).toBeVisible();
      expect(await page.evaluate(() => window.modelCopyStarts)).toBe(1);
      await expect(region.getByText(copy.magpieCatalogConsent, { exact: true })).toHaveCount(0);
      await search.fill('preview');
      await search.focus();
      await settledTheme(page, region, theme === 'light' ? 'dark' : 'light');
      await expect(search).toHaveValue('preview');
      await expect(search).toBeFocused();
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
        [940, 700],
        [760, 700],
      ]) {
        await page.setViewportSize({ width, height });
        await search.scrollIntoViewIfNeeded();
        await expect(search).toBeVisible();
        await expect
          .poll(() => region.evaluate(element => element.scrollWidth <= element.clientWidth))
          .toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await settledTheme(page, region, theme);
      await region.evaluate(element => {
        element.scrollTop = 0;
      });
      await page.screenshot({ path: `/tmp/companion-model-copy-${language}-${theme}.png` });
      const audit = await new AxeBuilder({ page }).include('[role="region"]').analyze();
      expect(audit.violations).toEqual([]);
      expect(failures).toEqual([]);
    });
