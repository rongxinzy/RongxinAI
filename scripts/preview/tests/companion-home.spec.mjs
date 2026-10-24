import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';

async function seed(page, language, theme) {
  await page.addInitScript(
    ({ language, theme }) => {
      let api;
      Object.defineProperty(window, 'electron', {
        configurable: true,
        get: () => api,
        set(value) {
          value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
          const get = value.store.get;
          value.store.get = async key => {
            const stored = await get(key);
            return key === 'app_config'
              ? { ...stored, language, theme, language_initialized: true }
              : stored;
          };
          api = value;
        },
      });
    },
    { language, theme },
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto(`/?previewScenario=empty&previewSkipBoot=1&language=${language}&theme=${theme}`);
  await expect(page.getByTestId('sidebar-view-companion')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('combobox')).toBeEnabled();
}

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark']) {
    test(`companion is the home and both page drafts survive navigation in ${language} ${theme}`, async ({
      page,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion home');
      await seed(page, language, theme);
      await expect(
        page.getByRole('heading', {
          name: language === 'zh' ? '你的智能伙伴' : 'Your intelligent companion',
        }),
      ).toBeVisible();
      await expect(page.getByRole('switch')).toHaveCount(0);
      const input = page.getByRole('textbox');
      await input.fill('A private thought for my companion');
      await input.evaluate(element => element.setSelectionRange(2, 9));
      await page.getByTestId('sidebar-view-workbench').click();
      await expect(page.getByTestId('sidebar-view-workbench')).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('switch')).toBeVisible();
      await page.getByRole('textbox').fill('A separate workbench task draft');
      await page.getByTestId('sidebar-view-companion').click();
      await expect(input).toHaveValue('A private thought for my companion');
      await expect(input).toBeFocused();
      expect(
        await input.evaluate(element => [element.selectionStart, element.selectionEnd]),
      ).toEqual([2, 9]);
      await page.getByTestId('sidebar-view-workbench').click();
      await expect(page.getByRole('textbox')).toHaveText('A separate workbench task draft');
      await page.getByTestId('sidebar-view-companion').click();
      const accessibility = await new AxeBuilder({ page }).include('[data-main-canvas]').analyze();
      expect(accessibility.violations.map(item => item.id)).toEqual([]);
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
        await expect(
          page.getByRole('button', { name: language === 'zh' ? '发送' : 'Send', exact: true }),
        ).toBeVisible();
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `/tmp/companion-home-${language}-${theme}.png` });
      expect(failures).toEqual([]);
    });
  }

test('home renders one admitted chat and isolates its draft from the quick window', async ({
  page,
}) => {
  await seed(page, 'zh', 'light');
  const input = page.getByRole('textbox');
  await input.fill('把今天的安排梳理一下。');
  await input.press('Enter');
  await expect(page.getByText('把今天的安排梳理一下。', { exact: true })).toHaveCount(1);
  await expect(page.getByText('先把最想解决的一件事说给我听。', { exact: true })).toBeVisible();
  await input.fill('Keep the home draft');
  const profile = await page.evaluate(() => window.electron.companion.bootstrap());
  const quick = await page.context().newPage();
  await quick.goto('/companion.html');
  await expect(quick.getByRole('textbox')).toHaveValue('');
  await quick.getByRole('textbox').fill('Keep the quick-window draft');
  await quick.close();
  await page.reload();
  await expect(input).toHaveValue('Keep the home draft');
  expect(
    await page.evaluate(
      id => JSON.parse(localStorage.getItem(`zhiyuan-companion-draft:${id}`)).text,
      profile.activePetId,
    ),
  ).toBe('Keep the quick-window draft');
});

test('a selection from another surface cannot send the previous companion’s pending input', async ({
  page,
}) => {
  await seed(page, 'zh', 'dark');
  const input = page.getByRole('textbox');
  await input.fill('Keep this with Xiaoyuan');
  await page.evaluate(() => {
    const submit = window.electron.companion.submit;
    window.electron.companion.submit = async request => {
      await new Promise(resolve => {
        window.releaseOldSubmission = resolve;
      });
      return submit(request);
    };
  });
  await input.press('Enter');
  await page.evaluate(async () => {
    const state = await window.electron.companion.bootstrap();
    await window.electron.companion.select(state.profiles[1].petId);
  });
  await expect(page.getByRole('combobox')).toContainText('游栗');
  await expect(input).toHaveValue('');
  await page.evaluate(() => window.releaseOldSubmission());
  await expect(page.getByRole('combobox')).toBeEnabled();
  await expect(page.getByText('Keep this with Xiaoyuan', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: '小远', exact: true }).click();
  await expect(input).toHaveValue('Keep this with Xiaoyuan');
});

test('home hot appearance changes retain the input and open selector, and keyboard navigation reaches the workbench', async ({
  page,
}) => {
  await seed(page, 'zh', 'light');
  const input = page.getByRole('textbox');
  await input.fill('Keep this selection while the appearance changes');
  await input.evaluate(element => element.setSelectionRange(3, 12));
  await page.evaluate(async () => {
    const source = new URL('/src/renderer/services/theme.ts', location.origin).href;
    const { themeService } = await import(source);
    const languageSource = new URL('/src/renderer/services/i18n.ts', location.origin).href;
    const { i18nService } = await import(languageSource);
    themeService.setTheme('dark');
    i18nService.setLanguage('en', { persist: false });
  });
  await expect(page.getByRole('heading', { name: 'Your intelligent companion' })).toBeVisible();
  await expect(input).toBeFocused();
  expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([
    3, 12,
  ]);
  await page.getByRole('combobox').click();
  await page.evaluate(async () => {
    const source = new URL('/src/renderer/services/theme.ts', location.origin).href;
    const { themeService } = await import(source);
    const languageSource = new URL('/src/renderer/services/i18n.ts', location.origin).href;
    const { i18nService } = await import(languageSource);
    themeService.setTheme('light');
    i18nService.setLanguage('zh', { persist: false });
  });
  await expect(page.getByRole('option', { name: '游栗', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('Keep this selection while the appearance changes');
  const workbench = page.getByTestId('sidebar-view-workbench');
  await workbench.focus();
  await workbench.press('Enter');
  await expect(workbench).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('sidebar-view-companion').focus();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('Keep this selection while the appearance changes');
});

test('workbench attachments and text remain available after visiting the companion', async ({
  page,
}) => {
  await seed(page, 'zh', 'light');
  await page.getByTestId('sidebar-view-workbench').click();
  await page.getByRole('textbox').fill('保留工作台里的附件和草稿');
  await page.getByRole('button', { name: '文件和图片', exact: true }).click();
  await page.getByRole('menuitem', { name: '文件和图片', exact: true }).click();
  await expect(page.getByText('notes.md', { exact: true })).toBeVisible();
  await page.getByTestId('sidebar-view-companion').click();
  await page.getByRole('textbox').fill('这是一段伙伴草稿');
  await page.getByTestId('sidebar-view-workbench').click();
  await expect(page.getByRole('textbox')).toHaveText('保留工作台里的附件和草稿');
  await expect(page.getByText('notes.md', { exact: true })).toBeVisible();
});
