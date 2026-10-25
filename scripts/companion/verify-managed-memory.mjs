import { expect } from '@playwright/test';
import path from 'node:path';
import { MemoryLifecycleStatus } from '../../src/shared/memory/constants.ts';

/** Actual settings/IPC/Engram operations in the caller's isolated acceptance app. */
export async function verifyManagedMemory(main, output) {
  await main.getByText('登录', { exact: true }).first().click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  await main.getByRole('button', { name: '外观', exact: true }).click();
  await main.getByRole('tab', { name: '跟随系统', exact: true }).click();
  await expect
    .poll(() => main.evaluate(async () => (await window.electron.store.get('app_config')).theme))
    .toBe('system');
  await main.getByRole('button', { name: '记忆', exact: true }).click();
  await main.getByRole('button', { name: '新增记忆', exact: true }).click();
  const dialog = main.getByRole('dialog');
  const title = dialog.getByLabel('标题', { exact: true });
  const content = dialog.getByLabel('内容', { exact: true });
  const save = dialog.getByRole('button', { name: '保存', exact: true });
  await expect(save).toBeDisabled();
  await title.fill('原生记忆校验');
  const initialContent = '周报先列结论，再列需要我确认的事项。'.repeat(30);
  await content.fill(initialContent);
  for (const theme of ['light', 'dark']) {
    await content.click();
    await main.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(main.locator('html')).toHaveClass(new RegExp(theme));
    await expect(content).toHaveValue(initialContent);
    await expect(content).toBeFocused();
    await expect(save).toBeInViewport();
    await main.screenshot({ path: path.join(output, `managed-memory-${theme}.png`) });
  }
  await save.click();
  await expect(dialog).toHaveCount(0);
  const records = async () => (await main.evaluate(() => window.electron.memory.list({}))).data;
  await expect
    .poll(async () => (await records()).some(record => record.title === '原生记忆校验'))
    .toBe(true);
  await main.getByText('原生记忆校验', { exact: true }).click();
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  await title.fill('原生记忆校验（已修改）');
  await content.fill('周报先列结论，最后列下周计划。');
  await save.click();
  await expect(dialog).toHaveCount(0);
  const edited = () => main.getByText('原生记忆校验（已修改）', { exact: true });
  await edited().click();
  await dialog.getByRole('button', { name: '更多操作', exact: true }).click();
  await main.getByRole('menuitem', { name: '删除', exact: true }).click();
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await records()).find(record => record.title === '原生记忆校验（已修改）')?.status,
    )
    .toBe(MemoryLifecycleStatus.Deleted);
  await edited().click();
  await dialog.getByRole('button', { name: '更多操作', exact: true }).click();
  await main.getByRole('menuitem', { name: '删除', exact: true }).click();
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  console.log(
    JSON.stringify({
      managedMemoryAfterDelete: (await records())
        .filter(record => record.title === '原生记忆校验（已修改）')
        .map(record => ({
          id: record.id,
          memoryId: record.memoryId,
          status: record.status,
          deliveryStatus: record.deliveryStatus,
          deliveryError: record.deliveryError,
        })),
    }),
  );
  await expect
    .poll(async () => (await records()).some(record => record.title === '原生记忆校验（已修改）'))
    .toBe(false);
  return { created: true, edited: true, deleted: true, permanentlyDeleted: true, themes: 2 };
}
