import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';

/** Hold a real bootstrap dependency in the mock, without adding a production preview switch. */
async function holdBootstrap(page, theme, language) {
  await page.addInitScript(
    ({ theme, language }) => {
      let api;
      const ready = new Promise(resolve => {
        window.releaseWelcome = resolve;
      });
      Object.defineProperty(window, 'electron', {
        configurable: true,
        get: () => api,
        set(value) {
          value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
          const get = value.store.get;
          value.store.get = async key => {
            const stored = await get(key);
            return key === 'app_config'
              ? { ...stored, theme, language, language_initialized: true }
              : stored;
          };
          const catalog = value.magpie.catalog;
          value.magpie.catalog = async () => {
            await ready;
            return catalog();
          };
          api = value;
        },
      });
    },
    { theme, language },
  );
}

for (const theme of ['light', 'dark']) {
  test(`seven companions welcome the user in ${theme} and leave when initialization is ready`, async ({
    page,
  }) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'welcome');
    await page.emulateMedia({ colorScheme: theme });
    await holdBootstrap(page, theme, 'zh');
    await page.goto('/?previewScenario=empty');
    const screen = page.getByTestId('companion-welcome');
    await expect(screen.getByRole('heading')).toHaveText('你好，见到你真好。');
    await expect(screen.getByRole('status')).toHaveText('正在准备…');
    const art = screen.getByRole('img');
    await expect(art).toHaveAttribute('alt', /小远、游栗、团团、绵绵、竹栗、云墨和麦小/);
    await expect.poll(() => art.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(screen.getByRole('heading')).toHaveCSS('font-size', '24px');
    await expect(screen.locator('figure')).toHaveCSS('opacity', '1');
    expect((await new AxeBuilder({ page }).analyze()).violations.map(item => item.id)).toEqual([]);
    await page.screenshot({ path: `/tmp/companion-welcome-${theme}.png` });
    await page.setViewportSize({ width: 448, height: 560 });
    expect(
      await screen.evaluate(
        el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/companion-welcome-${theme}-narrow.png` });
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
      [1024, 768],
      [940, 700],
      [760, 700],
    ]) {
      await page.setViewportSize({ width, height });
      expect(
        await screen.evaluate(
          el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth,
        ),
      ).toBe(true);
    }
    await art.evaluate(img => (img.dataset.welcomeIdentity = 'preserved'));
    await page.evaluate(
      async next => {
        const source = new URL('/src/renderer/services/theme.ts', location.origin).href;
        const { themeService } = await import(source);
        themeService.setTheme(next);
      },
      theme === 'dark' ? 'light' : 'dark',
    );
    await expect
      .poll(() => screen.evaluate(el => getComputedStyle(el).backgroundColor))
      .toBe(theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(24, 25, 29)');
    await expect(art).toHaveAttribute('data-welcome-identity', 'preserved');
    await page.evaluate(() => window.releaseWelcome());
    await expect(screen).toBeHidden();
    await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeVisible();
    expect(failures).toEqual([]);
  });
}

test('reduced motion disables the entrance and a missing image cannot block the workbench', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await holdBootstrap(page, 'dark', 'en');
  await page.route('**/companions-welcome.png*', route =>
    route.request().resourceType() === 'image' ? route.abort() : route.continue(),
  );
  await page.goto('/?previewScenario=empty');
  const screen = page.getByTestId('companion-welcome');
  await expect(screen.getByRole('heading')).toHaveText('Hello. It’s good to see you.');
  await expect(screen.getByRole('img')).toHaveCount(0);
  await expect(screen.locator('figure')).toHaveCSS('animation-name', 'none');
  expect(
    await screen.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration)),
  ).toBeLessThanOrEqual(0.00001);
  await page.evaluate(() => window.releaseWelcome());
  await expect(screen).toBeHidden();
  await expect(page.getByRole('button', { name: 'New Task', exact: true })).toBeVisible();
});
