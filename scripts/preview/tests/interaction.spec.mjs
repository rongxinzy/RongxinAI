import { expect, test } from '@playwright/test';

import { PreviewScenario } from '../shared/constants.mjs';
import {
  applyDeterministicRendering,
  attachConsoleGuards,
  home,
  previewSearch,
} from '../shared/harness.mjs';

test('streams a mock reply in the default scenario', async ({ page, baseURL }) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'stream');
  await applyDeterministicRendering(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  const search = previewSearch({ scenario: PreviewScenario.Default, skipBoot: true });
  await home(page, baseURL ?? 'http://127.0.0.1:5176/', search);

  const input = page.getByRole('textbox').last();
  await input.click();
  await page.keyboard.type('Add a percent key');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Browser preview reply is ready')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('textbox').last()).toHaveText('', { timeout: 5_000 });

  const problem = await page.evaluate(async () => {
    const directory = await window.electron.dialog.selectDirectory();
    const files = await window.electron.dialog.selectFiles({ multiple: false });
    if (!directory.success || directory.path !== '/home/user/projects/preview')
      return 'selectDirectory';
    if (!files.success || files.paths.length !== 1) return 'selectFiles';
    return '';
  });
  expect(problem).toBe('');

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
});

test('switches work and chat modes', async ({ page, baseURL }) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'mode-switch');
  await applyDeterministicRendering(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

  const search = previewSearch({ scenario: PreviewScenario.Default, skipBoot: true });
  await home(page, baseURL ?? 'http://127.0.0.1:5176/', search);

  await page.getByRole('switch', { name: 'Work / Chat' }).click();
  await expect(page.getByText('Draft a weekly update').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('switch', { name: 'Work / Chat' }).click();
  await expect(page.getByText('Calculator', { exact: true }).first()).toBeVisible();

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
});

for (const colorScheme of ['light', 'dark']) {
  test(`opens task search from the keyboard with a collapsed sidebar in ${colorScheme}`, async ({
    page,
    baseURL,
  }) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'task-search');
    await applyDeterministicRendering(page);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await home(page, baseURL, previewSearch({ scenario: PreviewScenario.Default, skipBoot: true }));
    await expect(page).toHaveTitle('ZhiYuan Agent');
    await expect
      .poll(() => page.locator('html').evaluate(root => root.classList.contains('dark')))
      .toBe(colorScheme === 'dark');

    await page.getByRole('button', { name: 'Collapse', exact: true }).click();
    const editor = page.getByRole('textbox').last();
    await editor.fill('Keep this search draft');
    await page.keyboard.press('ControlOrMeta+K');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: 'Search tasks...' })).toBeFocused();
    await expect(dialog).toHaveCSS('border-radius', '16px');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('Keep this search draft');
    expect(failures).toEqual([]);
  });
}
