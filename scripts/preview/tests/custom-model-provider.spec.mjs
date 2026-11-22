import { expect, test } from '@playwright/test';
import { attachConsoleGuards, home } from '../shared/harness.mjs';

test('discovers and saves a custom model provider without an API key', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'custom-model-provider');
  await page.addInitScript(() => {
    let bridge;
    Object.defineProperty(window, 'electron', {
      configurable: true,
      get: () => bridge,
      set(value) {
        value.magpie.testProvider = async input => {
          window.testedProvider = input;
          return { ok: true, discoveredModels: ['preview-local-model'] };
        };
        value.magpie.saveProvider = async input => {
          window.savedProvider = input;
          return [...(await value.magpie.providers()), { ...input, off: false, hasKey: false }];
        };
        bridge = value;
      },
    });
  });
  await home(page, baseURL, '?previewSkipBoot=1');
  await expect(page).toHaveTitle('ZhiYuan Agent');
  await page.getByText('Login', { exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('button', { name: 'Add Provider', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /ollama/i })).toHaveCount(0);
  await dialog.getByRole('button', { name: /^OpenAI\b/ }).click();
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back', exact: true }).first().click();

  await dialog.getByRole('button', { name: /Custom provider/ }).click();
  await expect(dialog.getByLabel('API key (optional)')).toHaveValue('');
  const testConnection = dialog.getByRole('button', { name: 'Test connection' });
  await expect(testConnection).toBeDisabled();
  await dialog.getByLabel('Provider Name').fill('Preview keyless provider');
  const baseUrl = 'http://127.0.0.1:11434/v1';
  await dialog.getByLabel('Base URL').fill(baseUrl);
  await testConnection.click();
  await expect(dialog.getByText('Connected', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.testedProvider)).toMatchObject({
    api: 'openai-completions',
    baseUrl,
    key: undefined,
  });
  if (process.env.PREVIEW_PROVIDER_SCREENSHOT) {
    await page.screenshot({ path: process.env.PREVIEW_PROVIDER_SCREENSHOT });
  }
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText('preview-local-model', { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /default model/i }).uncheck();
  await dialog.getByRole('button', { name: 'Save & enable' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Preview keyless provider', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.savedProvider)).toMatchObject({
    api: 'openai-completions',
    baseUrl,
    key: undefined,
    models: ['preview-local-model'],
  });
  expect(failures).toEqual([]);
});
