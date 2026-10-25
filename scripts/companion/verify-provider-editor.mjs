import { expect } from '@playwright/test';
import path from 'node:path';

/** Uses the isolated gateway/model fixture installed by verify-task-electron, with real IPC. */
export async function verifyProviderEditor(main, region, copy, language, output) {
  const id = 'aaa-companion-fixture';
  const name = 'Isolated companion fixture edited';
  const before = await main.evaluate(async id => {
    const provider = (await window.electron.magpie.providers()).find(item => item.id === id);
    if (!provider || provider.hasKey || provider.models.join() !== 'fixture-model')
      throw new Error('Expected the isolated keyless provider fixture');
    return {
      url: provider.baseUrl,
      defaultModelId: (await window.electron.magpie.catalog()).defaultModelId,
    };
  }, id);
  const edit = region.getByRole('button', { name: copy.magpieEditProvider, exact: true }).first();
  await edit.click();
  const dialog = main.getByRole('dialog', { name: copy.magpieEditProvider, exact: true });
  await expect(dialog).toHaveCSS('opacity', '1');
  const nameInput = dialog.getByLabel(copy.magpieProviderName, { exact: true });
  await nameInput.fill(name);
  await dialog.getByRole('button', { name: copy.magpieTestAndDiscover, exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(copy.magpieTestSuccess);
  await expect(dialog.locator('[data-provider-model]')).toHaveCount(1);
  const fallback = dialog.getByLabel(copy.magpieProviderFallback, { exact: true });
  await fallback.fill('fixture-model');
  // Field changes clear the previous test verdict, rather than retaining a stale green status.
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await nameInput.focus();
  await nameInput.evaluate(element => element.setSelectionRange(0, 8));
  for (const theme of ['light', 'dark']) {
    await main.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(main.locator('html')).toHaveClass(new RegExp(theme));
    await expect(dialog).toHaveCSS(
      'background-color',
      theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(37, 39, 47)',
    );
    await expect(nameInput).toHaveValue(name);
    await expect(nameInput).toBeFocused();
    expect(
      await nameInput.evaluate(element => [element.selectionStart, element.selectionEnd]),
    ).toEqual([0, 8]);
    await main.screenshot({ path: path.join(output, `provider-editor-${theme}.png`) });
  }
  await dialog
    .getByRole('button', { name: language === 'zh' ? '保存' : 'Save', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const saved = await main.evaluate(async id => {
    const provider = (await window.electron.magpie.providers()).find(item => item.id === id);
    return {
      name: provider?.name,
      models: provider?.models,
      fallback: provider?.fallback,
      keyless: provider?.hasKey === false,
      defaultModelId: (await window.electron.magpie.catalog()).defaultModelId,
    };
  }, id);
  expect(saved).toEqual({
    name,
    models: ['fixture-model'],
    fallback: ['fixture-model'],
    keyless: true,
    defaultModelId: before.defaultModelId,
  });
  await edit.click();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(nameInput).toHaveValue(name);
  await expect(fallback).toHaveValue('fixture-model');
  await expect(dialog.getByLabel(copy.magpieProviderBaseUrl, { exact: true })).toHaveValue(
    before.url,
  );
  await main.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  return {
    testedWithRealIpc: true,
    savedAndReloaded: true,
    defaultModelRetained: true,
    keyless: true,
    draftAndSelectionRetained: true,
  };
}
