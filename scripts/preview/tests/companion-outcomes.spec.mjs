import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';
import { CompanionRequestState } from '../../../src/shared/companion/constants.ts';

for (const language of ['zh', 'en']) {
  for (const theme of ['light', 'dark']) {
    test(`restored chat outcomes keep their meaning in ${language} ${theme}`, async ({ page }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion outcome');
      await page.addInitScript(() => {
        let current;
        Object.defineProperty(window, 'companion', {
          configurable: true,
          get: () => current,
          set: api => {
            current = api;
            const subscribe = api.onContext;
            api.onContext = listener => {
              window.outcomeContext = listener;
              return subscribe(listener);
            };
          },
        });
      });
      await page.setViewportSize({ width: 448, height: 400 });
      await page.goto(`/companion.html?language=${language}&theme=${theme}`);
      const input = page.getByRole('textbox');
      await expect(input).toBeEnabled();
      await input.fill('Keep this draft while the old reply is inspected');
      await input.focus();
      await page.evaluate(async state => {
        const bootstrap = window.companion.bootstrap;
        const current = await bootstrap();
        window.restoreOutcome = state;
        window.companion.bootstrap = async () => {
          const value = await bootstrap();
          return {
            ...value,
            conversation: {
              messages: [{ id: 1, role: 'user', text: 'The earlier admitted question' }],
              pending: null,
              lastReply: {
                petId: value.activePetId,
                requestId: 'earlier',
                submissionId: 1,
                state: window.restoreOutcome,
              },
            },
          };
        };
        await window.companion.select(current.activePetId);
      }, CompanionRequestState.Unanswered);
      const failureText = language === 'zh' ? '回复中断了' : 'Reply interrupted';
      await expect(page.getByRole('alert')).toHaveText(failureText);
      await expect(
        page.getByRole('button', { name: language === 'zh' ? '刷新状态' : 'Refresh status' }),
      ).toHaveCount(0);
      await expect(input).toHaveValue('Keep this draft while the old reply is inspected');
      for (const height of [400, 240]) {
        await page.setViewportSize({ width: 448, height });
        await input.scrollIntoViewIfNeeded();
        await expect(input).toBeVisible();
        await page.getByRole('alert').scrollIntoViewIfNeeded();
        await expect(page.getByRole('alert')).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
      await page.setViewportSize({ width: 448, height: 400 });
      await page.screenshot({
        path: `/tmp/companion-outcome-${language}-${theme}-failure.png`,
        omitBackground: true,
      });

      // Switch current context without recreating the input, its selection, or the restored outcome.
      await input.focus();
      await input.evaluate(element => element.setSelectionRange(5, 15));
      await page.evaluate(context => window.outcomeContext({ ...context, themeStyle: '' }), {
        theme: theme === 'light' ? 'dark' : 'light',
        language: language === 'zh' ? 'en' : 'zh',
      });
      await expect(page.getByRole('alert')).toHaveText(
        language === 'zh' ? 'Reply interrupted' : '回复中断了',
      );
      await expect(input).toBeFocused();
      expect(
        await input.evaluate(element => [element.selectionStart, element.selectionEnd]),
      ).toEqual([5, 15]);
      const taskTab = page.getByRole('tab', {
        name: language === 'zh' ? 'Give a task' : '交代任务',
        exact: true,
      });
      await taskTab.click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page
        .getByRole('tab', { name: language === 'zh' ? 'Chat' : '聊天', exact: true })
        .click();
      await expect(page.getByRole('alert')).toBeVisible();
      const axe = await new AxeBuilder({ page }).include('[data-companion-bubble]').analyze();
      expect(axe.violations).toEqual([]);
      expect(failures).toEqual([]);
    });

    test(`explicit stop is a quiet outcome in ${language} ${theme}`, async ({ page }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion stop outcome');
      await page.setViewportSize({ width: 448, height: 400 });
      await page.goto(`/companion.html?language=${language}&theme=${theme}`);
      const input = page.getByRole('textbox');
      await expect(input).toBeEnabled();
      await input.fill('Stop this reply');
      await input.press('Enter');
      await page
        .getByRole('button', {
          name: language === 'zh' ? '停止回复' : 'Stop replying',
          exact: true,
        })
        .click();
      const stopped = language === 'zh' ? '已停止回复' : 'Reply stopped';
      await expect(page.getByRole('status')).toHaveText(stopped);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await input.fill('The next thought stays here');
      await expect(page.getByRole('status')).toHaveText(stopped);
      await expect(input).toHaveValue('The next thought stays here');
      await page.screenshot({
        path: `/tmp/companion-outcome-${language}-${theme}-stopped.png`,
        omitBackground: true,
      });
      await input.press('Enter');
      await expect(page.getByText(stopped, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveText(
        language === 'zh' ? '正在回复' : 'Replying',
      );
      expect(failures).toEqual([]);
    });
  }
}
