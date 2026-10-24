import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { WorkbenchRunStatus } from '../../../src/shared/workbenchTask/constants.ts';

for (const theme of ['light', 'dark']) {
  test(`task admission, workbench link and explicit stop in ${theme}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width: 448, height: 640 });
    await page.goto(`/companion.html?language=zh&theme=${theme}`);
    await page.getByRole('tab', { name: '交代任务', exact: true }).click();
    const input = page.getByRole('textbox');
    await input.fill('整理项目资料，汇总还没有完成的事项，并给出下一步建议。');
    await input.press('Enter');
    await expect(page.getByRole('alert')).toContainText('选择工作区');
    await page.getByRole('combobox', { name: '工作区', exact: true }).click();
    await page.getByRole('option', { name: 'Preview project', exact: true }).click();
    const original = await input.inputValue();
    await page.reload();
    await expect(page.getByRole('tab', { name: '交代任务', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(input).toHaveValue(original);
    await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
      'Preview project',
    );
    await input.press('Enter');
    await expect(input).toHaveValue('');
    const task = page.getByRole('button', { name: new RegExp(original) });
    await expect(task).toContainText('已受理');
    const [accepted] = await page.evaluate(() => window.companion.tasks());
    await task.click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-companion-task',
      accepted.receipt.sessionId,
    );
    await page.screenshot({ path: `/tmp/companion-task-${theme}.png` });
    expect((await new AxeBuilder({ page }).analyze()).violations.map(item => item.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '停止任务', exact: true }).click();
    await expect(task).toContainText('已停止');
    await page.getByRole('button', { name: '停止任务', exact: true }).waitFor({ state: 'hidden' });
    expect(errors).toEqual([]);
  });
}

test('unavailable task execution preserves draft, workspace and request key', async ({ page }) => {
  await page.goto('/companion.html?offline=1');
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await page.getByRole('option', { name: 'Preview project', exact: true }).click();
  const input = page.getByRole('textbox');
  await input.fill('下次有模型时，再处理这份项目。');
  const draft = await page.evaluate(() =>
    localStorage.getItem('zhiyuan-companion-draft:00000000-0000-4000-8000-000000000001'),
  );
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('暂时没有可用模型，内容已保留。');
  expect(
    await page.evaluate(() =>
      localStorage.getItem('zhiyuan-companion-draft:00000000-0000-4000-8000-000000000001'),
    ),
  ).toBe(draft);
  await expect(input).toHaveValue('下次有模型时，再处理这份项目。');
  expect(await page.evaluate(() => window.companion.tasks())).toEqual([]);
});

test('task state events are scoped to their companion and late admission never clears a newer draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        value.onTasks = listener => {
          window.tasksChanged = listener;
          return () => {};
        };
        api = value;
      },
    });
  });
  await page.goto('/companion.html');
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await page.getByRole('option', { name: 'Preview project', exact: true }).click();
  const input = page.getByRole('textbox');
  await input.fill('The first task');
  await page.evaluate(() => {
    const submit = window.companion.submitTask;
    window.companion.submitTask = async request => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return submit(request);
    };
  });
  await input.press('Enter');
  await input.fill('Keep this next task');
  const task = page.getByRole('button', { name: /The first task/ });
  await expect(task).toContainText('已受理');
  await expect(input).toHaveValue('Keep this next task');
  await page.evaluate(async status => {
    const [task] = await window.companion.tasks();
    window.tasksChanged('another-pet', [{ ...task, status }]);
  }, WorkbenchRunStatus.WaitingApproval);
  await expect(task).toContainText('已受理');
  await page.evaluate(async status => {
    const [task] = await window.companion.tasks();
    window.tasksChanged(task.receipt.petId, [{ ...task, status }]);
  }, WorkbenchRunStatus.WaitingApproval);
  await expect(task).toContainText('需要确认');
  await expect(input).toHaveValue('Keep this next task');
});

test('task workspace, draft and open selector survive hot appearance changes at all supported sizes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        value.onContext = listener => {
          window.taskContext = listener;
          return () => {};
        };
        api = value;
      },
    });
  });
  await page.goto('/companion.html');
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await page.getByRole('option', { name: 'Preview project', exact: true }).click();
  const input = page.getByRole('textbox');
  await input.fill('Keep this task draft and workspace while appearance changes');
  await input.evaluate(element => element.setSelectionRange(2, 10));
  await page.evaluate(() => window.taskContext({ language: 'en', theme: 'dark', themeStyle: '' }));
  await expect(input).toHaveValue('Keep this task draft and workspace while appearance changes');
  await expect(input).toBeFocused();
  expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([
    2, 10,
  ]);
  await expect(page.getByRole('tab', { name: 'Give a task', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1024, 768],
    [940, 700],
    [760, 700],
    [448, 560],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: 'Start task', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).click();
  await page.evaluate(() => window.taskContext({ language: 'zh', theme: 'light', themeStyle: '' }));
  await expect(page.getByRole('option', { name: 'Preview project', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '工作区', exact: true })).toContainText(
    'Preview project',
  );
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('Keep this task draft and workspace while appearance changes');
});
