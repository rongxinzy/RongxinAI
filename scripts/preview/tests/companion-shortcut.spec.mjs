import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { attachConsoleGuards, home } from '../shared/harness.mjs';

for (const platform of ['MacIntel', 'Win32']) {
  for (const colorScheme of ['light', 'dark']) {
    test(`companion shortcut stays discoverable and reserved on ${platform} in ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion shortcut');
      await page.addInitScript(platform => {
        Object.defineProperty(navigator, 'platform', { value: platform });
      }, platform);
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await home(page, baseURL, '?previewSkipBoot=1');
      await page.getByText('Login', { exact: true }).first().click();
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();

      const globalShortcut = page.getByRole('textbox', {
        name: 'Open companion chat',
        exact: true,
      });
      const isMac = platform === 'MacIntel';
      const modifier = isMac ? 'Meta' : 'Control';
      const label = isMac ? '⌘+Shift+Space' : 'Ctrl+Shift+Space';
      await expect(globalShortcut).toHaveValue(label);
      await expect(globalShortcut).toHaveAttribute('readonly', '');
      await expect(globalShortcut).toHaveAccessibleDescription('Global shortcut');
      await globalShortcut.focus();
      await page.keyboard.press('A');
      await expect(globalShortcut).toHaveValue(label);

      const stored = () => page.evaluate(() => window.electron.store.get('app_config'));
      const original = await stored();
      const recorder = page.locator('#shortcut-search');
      await recorder.click();
      await recorder.press(`${modifier}+Shift+Space`);
      await expect(page.getByText(/already used by "Open companion chat"/)).toBeVisible();
      expect((await stored()).shortcuts).toEqual(original.shortcuts);
      // The portable default and the platform-specific recorder spelling must also conflict.
      await recorder.click();
      await recorder.press(`${modifier}+N`);
      await expect(page.getByText(/already used by "New Chat"/)).toBeVisible();
      expect((await stored()).shortcuts).toEqual(original.shortcuts);

      await recorder.click();
      await recorder.press(`${modifier}+Alt+P`);
      const saved = `${isMac ? 'Cmd' : 'Ctrl'}+Alt+P`;
      await expect.poll(async () => (await stored()).shortcuts.search).toBe(saved);
      await recorder.click();
      await recorder.press('Escape');
      expect((await stored()).shortcuts.search).toBe(saved);
      await recorder.click();
      await recorder.press('Backspace');
      await expect.poll(async () => (await stored()).shortcuts.search).toBe('');

      for (const [width, height] of [
        [1280, 800],
        [1440, 900],
        [1024, 768],
        [940, 700],
        [760, 700],
      ]) {
        await page.setViewportSize({ width, height });
        await globalShortcut.scrollIntoViewIfNeeded();
        await expect(globalShortcut).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await globalShortcut.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await expect
        .poll(() => globalShortcut.evaluate(input => input.selectionEnd - input.selectionStart))
        .toBe(label.length);
      await page.emulateMedia({ colorScheme: colorScheme === 'light' ? 'dark' : 'light' });
      await expect(globalShortcut).toBeFocused();
      await expect(globalShortcut).toHaveValue(label);
      await expect
        .poll(() => globalShortcut.evaluate(input => input.selectionEnd - input.selectionStart))
        .toBe(label.length);
      await page.emulateMedia({ colorScheme });
      const foreground = colorScheme === 'dark' ? 'rgb(223, 225, 230)' : 'rgb(24, 29, 39)';
      await expect(globalShortcut).toHaveCSS('color', foreground);
      await expect(page.locator('label[for="shortcut-companion"]')).toHaveCSS('color', foreground);
      const accessibility = await new AxeBuilder({ page })
        .include('[role="region"][aria-label="Shortcuts"]')
        .analyze();
      expect(
        accessibility.violations.map(violation => ({
          id: violation.id,
          nodes: violation.nodes.map(node => ({
            html: node.html,
            summary: node.failureSummary,
          })),
        })),
      ).toEqual([]);
      await page.screenshot({ path: `/tmp/companion-shortcut-${platform}-${colorScheme}.png` });
      await page.addScriptTag({
        type: 'module',
        content:
          "import { i18nService } from '/src/renderer/services/i18n.ts'; i18nService.setLanguage('zh', { persist: false });",
      });
      await expect(page.getByRole('textbox', { name: '打开伙伴对话', exact: true })).toHaveValue(
        label,
      );
      await page.screenshot({ path: `/tmp/companion-shortcut-${platform}-${colorScheme}-zh.png` });
      expect(failures).toEqual([]);
    });
  }
}
