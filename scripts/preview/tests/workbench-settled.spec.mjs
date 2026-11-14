import { expect, test } from '@playwright/test';
import { attachConsoleGuards } from '../shared/harness.mjs';
import {
  WorkbenchExecutionStatus,
  WorkbenchRunEventType,
} from '../../../src/shared/workbenchTask/constants.ts';

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark']) {
    test(`trace reports execution settlement without business acceptance in ${language} ${theme}`, async ({
      page,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'settled trace');
      await page.addInitScript(
        ({ language, status, eventType }) => {
          let api;
          Object.defineProperty(window, 'electron', {
            configurable: true,
            get: () => api,
            set(value) {
              const get = value.store.get;
              value.store.get = async key =>
                key === 'app_config'
                  ? { ...(await get(key)), language, theme: 'system', language_initialized: true }
                  : get(key);
              value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
              const detail = {
                task: {
                  id: 'observed-task',
                  sessionId: 'session-1',
                  goal: '整理 32 篇文档 / Summarize 32 documents',
                  status,
                  contract: { kind: 'generic_work' },
                  activeRunId: null,
                  createdAt: 1000,
                  updatedAt: 3000,
                  endedAt: 3000,
                },
                runs: [
                  {
                    id: 'observed-run',
                    taskId: 'observed-task',
                    attempt: 1,
                    status,
                    trigger: 'message',
                    startedAt: 1000,
                    endedAt: 3000,
                    createdAt: 1000,
                    updatedAt: 3000,
                    failure: null,
                    context: {
                      model: 'Preview model',
                      provider: 'preview',
                      reasoningProfile: 'default',
                      workspaceRoot: '/workspace/documents',
                      skillIds: [],
                    },
                  },
                ],
                events: [
                  {
                    id: 'event-settled',
                    runId: 'observed-run',
                    sequence: 1,
                    type: eventType,
                    payload: {},
                    createdAt: 3000,
                  },
                ],
                artifacts: [],
                approvals: [],
              };
              value.workbenchTask.getCurrent = async () => ({ success: true, detail });
              value.workbenchTask.getDetail = async () => ({ success: true, detail });
              value.workbenchTask.listForSession = async () => ({
                success: true,
                tasks: [detail.task],
              });
              api = value;
            },
          });
        },
        {
          language,
          status: WorkbenchExecutionStatus.Settled,
          eventType: WorkbenchRunEventType.RunSettled,
        },
      );
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/?previewSkipBoot=1');
      await expect(page).toHaveTitle('ZhiYuan Agent');
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await page.getByText('Build a React calculator app', { exact: true }).first().click();
      const input = page.getByRole('textbox').last();
      await input.fill('Preserve the draft');
      const trace = page.getByRole('tab', {
        name: language === 'zh' ? '轨迹' : 'Trace',
        exact: true,
      });
      await trace.click();
      const panel = page.getByRole('tabpanel', {
        name: language === 'zh' ? '轨迹' : 'Trace',
        exact: true,
      });
      await expect(
        panel
          .getByText(language === 'zh' ? '执行已结束' : 'Execution ended', { exact: true })
          .first(),
      ).toBeVisible();
      await expect(panel).not.toContainText(
        /任务成功|执行成功|待验收|验收通过|Run succeeded|Needs review|Acceptance required/,
      );
      const details = panel.getByRole('button', {
        name: language === 'zh' ? '任务详情' : 'Task details',
        exact: true,
      });
      await details.focus();
      await details.press('Enter');
      await expect(details).toHaveAttribute('aria-expanded', 'true');
      await expect(
        panel.getByText(language === 'zh' ? '人工验收' : 'User acceptance', { exact: true }),
      ).toHaveCount(0);
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await expect(details).toHaveAttribute('aria-expanded', 'true');
      await expect(details).toBeFocused();
      await page.emulateMedia({ colorScheme: theme });
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
        [940, 700],
        [760, 700],
      ]) {
        await page.setViewportSize({ width, height });
        await expect(panel).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.screenshot({ path: `/tmp/issue1448-trace-${language}-${theme}-narrow.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `/tmp/issue1448-trace-${language}-${theme}.png` });
      await page
        .getByRole('tab', { name: language === 'zh' ? '对话' : 'Conversation', exact: true })
        .click();
      await expect(page.getByRole('textbox').last()).toHaveText('Preserve the draft');
      expect(failures).toEqual([]);
    });
  }
