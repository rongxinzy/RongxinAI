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

  const problem = await page.evaluate(async () => {
    const directory = await window.electron.dialog.selectDirectory();
    const file = await window.electron.dialog.selectFile();
    const box = await window.electron.dialog.showMessageBox({ message: 'Preview' });
    if (!directory.success || directory.path !== '/home/user/projects/preview')
      return 'selectDirectory';
    if (!file.success || !file.path) return 'selectFile';
    if (box.response !== 0) return 'showMessageBox';
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
