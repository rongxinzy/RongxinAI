import { expect, test } from '@playwright/test';
import { WorkbenchRunStatus } from '../../../src/shared/workbenchTask/constants.ts';

test('a failed task event received during bootstrap survives its older reply', async ({ page }) => {
  await page.addInitScript(
    statuses => {
      let api;
      Object.defineProperty(window, 'companion', {
        configurable: true,
        get: () => api,
        set(value) {
          let changed;
          value.onTasks = listener => {
            changed = listener;
            return () => {};
          };
          const bootstrap = value.bootstrap;
          value.bootstrap = async () => {
            const state = await bootstrap();
            const task = {
              receipt: {
                petId: state.activePetId,
                requestId: 'fixture',
                sessionId: crypto.randomUUID(),
                taskId: crypto.randomUUID(),
                runId: crypto.randomUUID(),
              },
              title: 'Preserve the failure',
              status: statuses.running,
              missing: false,
            };
            await new Promise(resolve => setTimeout(resolve, 50));
            changed({
              petId: state.activePetId,
              revision: state.taskRevision + 1,
              tasks: [{ ...task, status: statuses.failed }],
            });
            return { ...state, tasks: [task] };
          };
          api = value;
        },
      });
    },
    { running: WorkbenchRunStatus.Running, failed: WorkbenchRunStatus.Failed },
  );
  await page.goto('/companion.html');
  await expect(page.locator('.theme-companion-name')).toHaveText('小远');
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await expect(page.getByRole('button', { name: /Preserve the failure/ })).toContainText('未完成');
});

test('a failed task event cannot be overwritten by an older admission refresh', async ({
  page,
}) => {
  await page.addInitScript(failed => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        let changed;
        value.onTasks = listener => {
          changed = listener;
          return () => {};
        };
        const tasks = value.tasks;
        value.tasks = async () => {
          const old = await tasks();
          changed({
            ...old,
            revision: old.revision + 1,
            tasks: old.tasks.map(task => ({ ...task, status: failed })),
          });
          return old;
        };
        api = value;
      },
    });
  }, WorkbenchRunStatus.Failed);
  await page.goto('/companion.html');
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await page.getByRole('option', { name: 'Preview project', exact: true }).click();
  await page.getByRole('textbox').fill('Preserve this admission failure');
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByRole('button', { name: /Preserve this admission failure/ })).toContainText(
    '未完成',
  );
});
