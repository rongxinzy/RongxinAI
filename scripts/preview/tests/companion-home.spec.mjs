import { expect, test } from '@playwright/test';
import { attachConsoleGuards } from '../shared/harness.mjs';

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark']) {
    test(`the workbench stays the home while companion chat lives in its bubble in ${language} ${theme}`, async ({
      page,
      context,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'workbench home');
      await page.addInitScript(() => {
        let api;
        window.companionReads = 0;
        Object.defineProperty(window, 'electron', {
          configurable: true,
          get: () => api,
          set(value) {
            const bootstrap = value.companion.bootstrap;
            value.companion.bootstrap = (...args) => {
              window.companionReads++;
              return bootstrap(...args);
            };
            api = value;
          },
        });
      });
      await page.goto(
        `/?previewScenario=empty&previewSkipBoot=1&language=${language}&theme=${theme}`,
      );
      await expect(page.getByTestId('sidebar-view-workbench')).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByTestId('sidebar-view-companion')).toHaveCount(0);
      await expect(page.locator('[data-companion-bubble]')).toHaveCount(0);
      const work = page.getByRole('textbox');
      await work.fill('Keep this workbench draft');
      const bubble = await context.newPage();
      attachConsoleGuards(bubble, failures, 'companion bubble');
      await bubble.setViewportSize({ width: 480, height: 400 });
      await bubble.goto(`/companion.html?language=${language}&theme=${theme}`);
      const input = bubble.getByRole('textbox');
      await input.fill('A separate companion draft');
      await expect(work).toHaveText('Keep this workbench draft');
      await expect(bubble.getByRole('heading')).toHaveClass('sr-only');
      await expect(bubble.locator('.theme-companion-sketch')).toBeVisible();
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
        [940, 700],
        [760, 700],
      ]) {
        await page.setViewportSize({ width, height });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(work).toHaveText('Keep this workbench draft');
      }
      await bubble.reload();
      await expect(input).toHaveValue('A separate companion draft');
      expect(await page.evaluate(() => window.companionReads)).toBe(0);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `/tmp/companion-workbench-${language}-${theme}.png` });
      await bubble.screenshot({ path: `/tmp/companion-bubble-${language}-${theme}.png` });
      await bubble.close();
      expect(failures).toEqual([]);
    });
  }
