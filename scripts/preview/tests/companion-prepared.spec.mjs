import { expect, test } from '@playwright/test';
import { attachConsoleGuards } from '../shared/harness.mjs';

test('a hidden prepared bubble loads no conversation until shown and stops refreshes when hidden', async ({
  page,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'prepared bubble');
  await page.addInitScript(() => {
    let api;
    window.preparedReads = 0;
    window.preparedLoads = 0;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        const bootstrap = value.bootstrap;
        value.bootstrap = async () => {
          window.preparedLoads++;
          return bootstrap();
        };
        value.visibility = async () => {
          window.preparedReads++;
          return false;
        };
        value.onVisibility = listener => {
          window.preparedVisibility = listener;
          return () => {};
        };
        value.onChanged = listener => {
          window.preparedChanged = listener;
          return () => {};
        };
        api = value;
      },
    });
  });
  await page.goto('/companion.html');
  await expect.poll(() => page.evaluate(() => window.preparedReads)).toBe(1);
  await expect(page.getByRole('textbox')).toBeDisabled();
  expect(await page.evaluate(() => window.preparedLoads)).toBe(0);
  await page.evaluate(() => window.preparedVisibility(true));
  await expect(page.getByRole('textbox')).toBeEnabled();
  await expect(page.getByRole('textbox')).toBeFocused();
  expect(await page.evaluate(() => window.preparedLoads)).toBe(1);
  await page.evaluate(() => {
    window.preparedThemeMutations = 0;
    const observer = new MutationObserver(records => {
      window.preparedThemeMutations += records.length;
    });
    observer.observe(document.getElementById('zhiyuan-theme-styles'), { childList: true });
    window.preparedChanged();
  });
  await expect.poll(() => page.evaluate(() => window.preparedLoads)).toBe(2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  expect(await page.evaluate(() => window.preparedThemeMutations)).toBe(0);
  await page.getByRole('textbox').fill('Keep this draft when the bubble hides');
  await page.evaluate(() => {
    window.preparedVisibility(false);
    window.preparedChanged();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  expect(await page.evaluate(() => window.preparedLoads)).toBe(2);
  await page.evaluate(() => window.preparedVisibility(true));
  await expect.poll(() => page.evaluate(() => window.preparedLoads)).toBe(3);
  await expect(page.getByRole('textbox')).toHaveValue('Keep this draft when the bubble hides');
  expect(failures).toEqual([]);
});
