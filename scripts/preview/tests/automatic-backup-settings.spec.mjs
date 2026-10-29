import { expect, test } from '@playwright/test';
import { home } from '../shared/harness.mjs';

for (const colorScheme of ['light', 'dark']) {
  test(`automatic backup rolls back failed saves and permits retry in ${colorScheme}`, async ({
    page,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      let bridge;
      window.backupWrites = 0;
      Object.defineProperty(window, 'electron', {
        configurable: true,
        get: () => bridge,
        set(value) {
          const save = value.store.set;
          value.store.set = async (key, config) => {
            if (window.backupDelay && key === 'app_config') {
              window.backupWrites += 1;
              await new Promise((resolve, reject) => {
                window.backupRelease = resolve;
                window.backupReject = () => reject(new Error('backup-test: disk full'));
              });
            }
            return save(key, config);
          };
          bridge = value;
        },
      });
    });
    const unexpectedErrors = [];
    page.on('pageerror', error => unexpectedErrors.push(error.message));
    page.on('console', message => {
      if (
        message.type() === 'error' &&
        !message.text().includes('backup-test: disk full') &&
        message.text() !== '[ErrorNormalization] operation failed: Failed to save settings'
      ) {
        unexpectedErrors.push(message.text());
      }
    });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await home(page, baseURL, '?previewSkipBoot=1');
    const openSettings = async () => {
      await page.getByText('Login', { exact: true }).first().click();
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    };
    await openSettings();
    const toggle = page.getByRole('switch', {
      name: 'Automatic Data Backup & Recovery',
      exact: true,
    });
    await expect(toggle).not.toBeChecked();
    await page.evaluate(() => {
      window.backupDelay = true;
    });
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeDisabled();
    await toggle.dispatchEvent('click');
    await expect.poll(() => page.evaluate(() => window.backupWrites)).toBe(1);
    await page.screenshot({ path: `/tmp/automatic-backup-${colorScheme}-pending.png` });
    await page.evaluate(() => window.backupReject());
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await expect(
      page.getByText('Operation failed: Failed to save settings', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `/tmp/automatic-backup-${colorScheme}-failed.png` });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.backupWrites)).toBe(2);
    await page.evaluate(() => {
      window.backupDelay = false;
      window.backupRelease();
    });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await openSettings();
    await expect(toggle).toBeChecked();
    for (const [width, height] of [
      [1280, 800],
      [760, 700],
    ]) {
      await page.setViewportSize({ width, height });
      await toggle.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: `/tmp/automatic-backup-${colorScheme}-${width}.png` });
    }
    expect(unexpectedErrors).toEqual([]);
  });
}
