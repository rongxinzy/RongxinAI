import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';

async function transfer(page, kind, name, content) {
  await page.getByRole('textbox').evaluate(
    (input, { kind, name, content }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], name, { type: 'text/plain' }));
      const event =
        kind === 'drop'
          ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
          : new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: transfer,
            });
      input.dispatchEvent(event);
    },
    { kind, name, content },
  );
}

for (const theme of ['light', 'dark'])
  test(`drop and paste merge into the task draft in ${theme}`, async ({ page }) => {
    const errors = [];
    attachConsoleGuards(page, errors, 'companion file transfer');
    await page.setViewportSize({ width: 448, height: 400 });
    await page.goto(`/companion.html?theme=${theme}&offline=1`);
    await page.getByRole('tab', { name: '交代任务', exact: true }).click();
    await page.getByRole('textbox').fill('保留这段交代。');
    await transfer(page, 'drop', '拖入的资料.txt', 'Dropped 中文 evidence');
    await expect(page.getByText('拖入的资料.txt', { exact: true })).toBeVisible();
    await transfer(page, 'paste', 'pasted-notes.txt', 'Pasted evidence');
    await expect(page.getByText('pasted-notes.txt', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveValue('保留这段交代。');
    await page.reload();
    await expect(page.getByText('拖入的资料.txt', { exact: true })).toBeVisible();
    await expect(page.getByText('pasted-notes.txt', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: '工作区', exact: true }).click();
    await page.getByRole('option', { name: 'Preview project', exact: true }).click();
    await page.getByRole('textbox').press('Enter');
    await expect(page.getByRole('alert')).toContainText('暂时没有可用模型');
    await expect(page.getByRole('button', { name: '移除', exact: true })).toHaveCount(2);
    await expect(page.locator('.theme-scroll-viewport')).toHaveCount(0);
    await page.getByRole('textbox').focus();
    await expect(page.getByRole('textbox')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).include('main').analyze()).violations.map(item => item.id),
    ).toEqual([]);
    await page.screenshot({ path: `/tmp/companion-file-transfer-${theme}.png` });
    expect(errors).toEqual([]);
  });

test('chat files explain the task mode and ordinary text paste stays native', async ({ page }) => {
  await page.goto('/companion.html?language=en&theme=dark');
  const input = page.getByRole('textbox');
  await expect(input).toBeEnabled();
  await transfer(page, 'paste', 'chat-file.txt', 'Not admitted');
  await expect(page.getByRole('alert')).toContainText('Switch to Give a task');
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  expect(
    await input.evaluate(input => {
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'https://example.com');
      return input.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
      );
    }),
  ).toBe(true);
});

test('typing during a delayed transfer is preserved and repeat drops cannot overlap it', async ({
  page,
}) => {
  await page.goto('/companion.html');
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await page.evaluate(() => {
    window.stageCalls = 0;
    window.companion.stageFile = (_pet, file) => {
      window.stageCalls++;
      return new Promise(resolve => {
        window.finishStaging = () =>
          resolve({ id: crypto.randomUUID(), name: file.name, bytes: file.data.byteLength });
      });
    };
  });
  await transfer(page, 'drop', 'first.txt', 'first');
  await expect.poll(() => page.evaluate(() => window.stageCalls)).toBe(1);
  await page.getByRole('textbox').fill('边添加边修改的草稿。');
  await expect(page.getByRole('button', { name: '开始任务', exact: true })).toBeDisabled();
  await transfer(page, 'drop', 'duplicate.txt', 'second');
  await page.evaluate(() => window.finishStaging());
  await expect(page.getByText('first.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('duplicate.txt', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.stageCalls)).toBe(1);
  await expect(page.getByRole('textbox')).toHaveValue('边添加边修改的草稿。');
});
