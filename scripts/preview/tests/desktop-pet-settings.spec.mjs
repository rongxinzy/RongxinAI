import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards, home } from '../shared/harness.mjs';

async function captureTaskBridge(page) {
  await page.addInitScript(() => {
    let bridge;
    window.petTaskResults = [];
    Object.defineProperty(window, 'electron', {
      configurable: true,
      get: () => bridge,
      set(value) {
        const save = value.desktopPet.setSettings;
        value.desktopPet.setSettings = async patch => {
          if (window.petDelaySave)
            await new Promise(resolve => {
              window.petSaveRelease = resolve;
            });
          return save(patch);
        };
        const subscribe = value.desktopPet.onOpenTask;
        value.desktopPet.onOpenTask = listener => {
          window.openPetTask = listener;
          return subscribe(listener);
        };
        const resolve = value.desktopPet.resolveTask;
        value.desktopPet.resolveTask = async (requestId, result) => {
          window.petTaskResults.push({ requestId, result });
          return resolve(requestId, result);
        };
        bridge = value;
      },
    });
  });
}

for (const colorScheme of ['light', 'dark']) {
  test(`companion settings save immediately and task navigation exits settings in ${colorScheme}`, async ({
    page,
    baseURL,
  }) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'desktop-pet-settings');
    await captureTaskBridge(page);
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await home(page, baseURL, '?previewSkipBoot=1');
    await page.getByText('Login', { exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const group = page.getByRole('region', { name: 'Desktop companion', exact: true });
    const enabled = group.getByRole('switch', { name: 'Show desktop companion', exact: true });
    await expect(enabled).not.toBeChecked();
    await page.evaluate(() => {
      window.petDelaySave = true;
    });
    await enabled.click();
    await expect(enabled).toBeDisabled();
    await expect(group.getByRole('switch', { name: 'Do not disturb', exact: true })).toBeDisabled();
    await page.screenshot({ path: `/tmp/desktop-pet-settings-${colorScheme}-saving.png` });
    await page.evaluate(() => {
      window.petDelaySave = false;
      window.petSaveRelease();
    });
    await expect(enabled).toBeEnabled();
    await expect(enabled).toBeChecked();
    const appearance = group.getByRole('combobox');
    await appearance.click();
    await expect(page.getByRole('option')).toHaveCount(7);
    await page.getByRole('option', { name: /Youli/ }).click();
    await expect(appearance).toContainText('Youli');
    const accessibility = await new AxeBuilder({ page })
      .include('section[aria-label="Desktop companion"]')
      .analyze();
    expect(accessibility.violations.map(violation => violation.id)).toEqual([]);
    await group.getByRole('switch', { name: 'Do not disturb', exact: true }).click();
    expect(await page.evaluate(() => window.electron.desktopPet.getSettings())).toEqual({
      enabled: true,
      doNotDisturb: true,
      hideInFullscreen: true,
      roaming: true,
      chatter: true,
      characterId: 'youli',
    });
    // Simulate a tray change through the same API and push subscription used by native settings.
    await page.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: false }));
    await expect(
      group.getByRole('switch', { name: 'Do not disturb', exact: true }),
    ).not.toBeChecked();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByText('Login', { exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await expect(enabled).toBeChecked();
    await expect(appearance).toContainText('Youli');
    await page.setViewportSize({ width: 1280, height: 800 });
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/desktop-pet-settings-${colorScheme}-1280.png` });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: `/tmp/desktop-pet-settings-${colorScheme}-1920.png` });
    await page.setViewportSize({ width: 760, height: 700 });
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
      [1024, 768],
      [940, 700],
      [760, 700],
    ]) {
      await page.setViewportSize({ width, height });
      await enabled.scrollIntoViewIfNeeded();
      await expect(enabled).toBeVisible();
      await appearance.scrollIntoViewIfNeeded();
      await expect(appearance).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    await group.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
    await expect(enabled).toBeVisible();
    await enabled.focus();
    await page.keyboard.press('Space');
    await expect(enabled).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(enabled).toBeChecked();
    await enabled.hover();
    await page.emulateMedia({ colorScheme: colorScheme === 'light' ? 'dark' : 'light' });
    await expect(enabled).toBeFocused();
    await expect(enabled).toBeChecked();
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Chinese', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: '桌面伙伴', exact: true })
        .getByRole('switch', { name: '显示桌面伙伴', exact: true }),
    ).toBeChecked();
    await page.screenshot({ path: `/tmp/desktop-pet-settings-${colorScheme}-zh.png` });
    await page.waitForFunction(() => typeof window.openPetTask === 'function');
    await page.evaluate(() => window.openPetTask({ requestId: 1, sessionId: 'session-1' }));
    await expect(page.getByRole('heading', { name: 'Build a React calculator app' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.petTaskResults))
      .toEqual([{ requestId: 1, result: 'opened' }]);
    expect(failures).toEqual([]);
  });
}
