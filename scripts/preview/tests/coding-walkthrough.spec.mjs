import { expect, test } from '@playwright/test';

import { PreviewScenario } from '../shared/constants.mjs';
import {
  applyDeterministicRendering,
  attachConsoleGuards,
  previewSearch,
} from '../shared/harness.mjs';

test('coding mode streams reasoning + markdown and surfaces artifact and elicitation cards', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'coding');
  await applyDeterministicRendering(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  await page.goto(`${baseURL}${previewSearch({ scenario: PreviewScenario.Coding })}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Coding' }).click();

  // Streaming indicator + settled Replace-mode assistant markdown.
  await expect(page.getByRole('button', { name: /Thinking/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/详见报告：目录共 87 个文件/)).toBeVisible({ timeout: 20_000 });

  // Reasoning is collapsed behind the indicator; reveal it.
  await page.getByRole('button', { name: /Thinking/ }).click();
  await expect(page.getByText('先扫描目录结构，再按模块给出重构优先级。')).toBeVisible({
    timeout: 10_000,
  });

  // Artifact preview card anchors to the streaming message.
  await expect(page.getByText('目录现状报告.md').first()).toBeVisible({ timeout: 10_000 });

  // Switch to the waiting-elicitation session to see the clarification card.
  await page.getByText('重构范围确认').first().click();
  await expect(page.getByText(/这次重构是只做目录梳理/)).toBeVisible({ timeout: 10_000 });

  expect(failures).toEqual([]);
});
