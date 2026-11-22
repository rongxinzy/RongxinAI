import { expect, test } from '@playwright/test';
import { attachConsoleGuards, home, previewSearch } from '../shared/harness.mjs';
import { historyMessages, installConversation } from '../shared/conversationFixture.mjs';
import { applyThemeRecipes } from '../shared/themeFixture.mjs';

const sizes = [
  [1280, 800],
  [1440, 900],
  [1024, 768],
  [940, 700],
  [760, 700],
];

for (const theme of ['light', 'dark']) {
  for (const [width, height] of sizes) {
    test(`conversation design ${theme} ${width}x${height}`, async ({ page, baseURL }, testInfo) => {
      const errors = [];
      attachConsoleGuards(page, errors, 'design');
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await home(page, baseURL, previewSearch());
      await page.evaluate(async theme => {
        const { themeService } = await import(
          new URL('/src/renderer/services/theme.ts', window.location.href).href
        );
        themeService.setTheme(theme);
      }, theme);
      await expect
        .poll(() => page.locator('html').evaluate(root => root.classList.contains('dark')))
        .toBe(theme === 'dark');
      const editor = page.getByRole('textbox').last();
      await expect(editor).toHaveCSS('font-size', '16px');
      await editor.fill('@');
      const option = page.getByRole('option').first();
      await expect(option).toHaveCSS('height', '32px');
      await expect(option).toHaveCSS('font-size', '14px');
      await page.keyboard.press('Escape');
      await installConversation(page, [
        ...historyMessages(1, 7),
        {
          id: 'u-final',
          type: 'user',
          content: '请更新报告并保留详细错误信息 / Update the report with a clear error message',
          timestamp: 2000,
        },
        {
          id: 't-final',
          type: 'tool_use',
          content: '',
          timestamp: 2001,
          metadata: {
            toolUseId: 'edit-final',
            toolName: 'edit',
            toolInput: {
              path: 'reports/quarterly-report-with-a-long-filename.md',
              oldText: 'Revenue: 100',
              newText: 'Revenue: 120',
            },
          },
        },
        {
          id: 'r-final',
          type: 'tool_result',
          content: 'EACCES: permission denied',
          timestamp: 2002,
          metadata: { toolUseId: 'edit-final', isError: true },
        },
      ]);
      await page.locator('[data-tool-name="edit"] button').first().click();
      await expect(page.getByText('EACCES: permission denied', { exact: true })).toBeVisible();
      await expect(page.locator('diffs-container')).toBeVisible();
      await page.locator('.cowork-conversation-scroll').hover();
      await page.mouse.wheel(0, -160);
      await editor.fill('保留这份草稿 / Keep this draft');
      await editor.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await expect
        .poll(() => editor.evaluate(() => window.getSelection().toString()))
        .toBe('保留这份草稿 / Keep this draft');
      const selection = await editor.evaluate(() => ({
        anchor: window.getSelection().anchorOffset,
        focus: window.getSelection().focusOffset,
        text: window.getSelection().toString(),
      }));
      expect(selection.text).not.toBe('');
      const original = await editor.elementHandle();
      const anchor = await page.locator('.cowork-conversation-scroll').evaluate(scroller => {
        const top = scroller.getBoundingClientRect().top;
        const row = [...scroller.querySelectorAll('[data-turn-id]')].find(
          row => row.getBoundingClientRect().bottom > top,
        );
        return { id: row.dataset.turnId, top: row.getBoundingClientRect().top };
      });
      const opposite = theme === 'light' ? 'dark' : 'light';
      await applyThemeRecipes(page, opposite, [
        ['conversation-editor', 'base', { 'font-size': '18px' }],
      ]);
      await expect(editor).toHaveCSS('font-size', '18px');
      await expect(editor).toHaveText('保留这份草稿 / Keep this draft');
      await expect(editor).toBeFocused();
      expect(await original.evaluate(element => element.isConnected)).toBe(true);
      expect(
        await editor.evaluate(() => ({
          anchor: window.getSelection().anchorOffset,
          focus: window.getSelection().focusOffset,
          text: window.getSelection().toString(),
        })),
      ).toEqual(selection);
      await expect(page.getByText('EACCES: permission denied', { exact: true })).toBeVisible();
      expect(
        Math.abs(
          (await page.locator(`[data-turn-id="${anchor.id}"]`).boundingBox()).y - anchor.top,
        ),
      ).toBeLessThan(2);
      await applyThemeRecipes(page, opposite, []);
      await applyThemeRecipes(page, theme, []);
      await expect(editor).toHaveCSS('font-size', '16px');
      const bounds = await editor.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      const marker = page.locator('.theme-conversation-turn-marker').first();
      if (width >= 1280) {
        expect(
          (
            await page
              .getByRole('navigation', { name: 'Conversation turns' })
              .locator('button')
              .first()
              .boundingBox()
          ).height,
        ).toBe(32);
        const duration = await marker.evaluate(
          element => getComputedStyle(element).transitionDuration,
        );
        expect(duration.split(',').every(value => Number.parseFloat(value) <= 0.01)).toBe(true);
      }
      if (width === 1280 || width === 760) {
        await page.locator('.cowork-conversation-scroll').evaluate(element => {
          element.scrollTop = element.scrollHeight;
        });
        await page.waitForTimeout(150);
        await page.screenshot({
          path: testInfo.outputPath(`conversation-${theme}-${width}x${height}.png`),
        });
      }
      expect(errors).toEqual([]);
    });
  }
}
