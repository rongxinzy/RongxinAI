import { expect } from '@playwright/test';
import path from 'node:path';

/** Read real task metrics in the native workbench, without replacing its IPC bridge. */
export async function verifyWorkbenchCopy(main, output) {
  const title = (await main.getByRole('button', { name: 'Run details', exact: true }).isVisible())
    ? 'Run details'
    : '运行信息';
  const trigger = main.getByRole('button', { name: title, exact: true });
  const popup = main.getByTestId('session-run-info');
  const input = main.getByRole('textbox').last();
  const draft = 'Keep this native workbench draft';
  await input.fill(draft);
  await trigger.focus();
  await trigger.press('Enter');
  await expect(popup).toBeVisible();
  const metrics = await popup.locator('dl > div').evaluateAll(rows =>
    rows.map(row => ({
      label: row.querySelector('dt').textContent,
      value: row.querySelector('dd').textContent,
    })),
  );
  expect(metrics.length).toBeGreaterThanOrEqual(2);
  expect(metrics[0].value).toBe('1');
  for (const theme of ['light', 'dark']) {
    await main.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(main.locator('html')).toHaveClass(new RegExp(theme));
    await expect(popup).toBeVisible();
    await expect(input).toHaveText(draft);
    await main.screenshot({ path: path.join(output, `workbench-copy-${theme}.png`) });
  }
  await main.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(input).toHaveText(draft);
  await main.screenshot({ path: path.join(output, 'workbench-copy-closed.png') });
  return { metrics, nativeBridge: true, retainedDraft: true, restoredFocus: true };
}
