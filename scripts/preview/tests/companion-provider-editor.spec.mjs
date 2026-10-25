import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { magpieTranslations } from '../../../src/renderer/services/magpieTranslations.ts';
import { ProviderDiscoveryResolution } from '../../../src/renderer/components/settings/model/providerEditor/constants.ts';
import { attachConsoleGuards } from '../shared/harness.mjs';
import { contrast } from '../shared/contrast.mjs';
import {
  providerModels,
  openProviderSettings,
  editProvider,
  paintedDialog,
  checkDialogBounds,
  changeProviderLanguage,
} from '../shared/provider-editor.mjs';

const diagnostics = new WeakMap();
test.beforeEach(async ({ page }) => {
  const failures = [];
  diagnostics.set(page, failures);
  attachConsoleGuards(page, failures, 'provider editor');
});
test.afterEach(async ({ page }) => {
  expect(diagnostics.get(page)).toEqual([]);
});

for (const language of ['zh', 'en'])
  for (const theme of ['light', 'dark']) {
    test(`provider editor keeps readable controls and drafts in ${language} ${theme}`, async ({
      page,
    }) => {
      const copy = await openProviderSettings(page, language, theme);
      const dialog = await editProvider(page, copy);
      await paintedDialog(page, dialog, theme);
      const name = dialog.getByLabel(copy.magpieProviderName, { exact: true });
      const protocol = dialog.getByRole('combobox', { name: copy.magpieProviderApi, exact: true });
      await expect(protocol).toContainText(copy.magpieProviderApiOpenAIChat);
      await expect(dialog.locator('[data-provider-model]')).toHaveCount(10);
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [1024, 768],
        [940, 700],
        [760, 700],
        [448, 640],
      ]) {
        await page.setViewportSize({ width, height });
        expect((await checkDialogBounds(page, dialog)).bodyScrolls).toBe(true);
        if (width === 448)
          await page.screenshot({
            path: `/tmp/companion-provider-narrow-${language}-${theme}.png`,
          });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      const body = dialog.locator('[data-slot="field-group"]').locator('..');
      await name.fill('Keep provider draft');
      await name.evaluate(element => element.setSelectionRange(2, 8));
      const beforeSelection = await name.evaluate(element => [
        element.selectionStart,
        element.selectionEnd,
      ]);
      await paintedDialog(page, dialog, theme === 'light' ? 'dark' : 'light');
      await expect(name).toBeFocused();
      expect(
        await name.evaluate(element => [element.selectionStart, element.selectionEnd]),
      ).toEqual(beforeSelection);
      await expect(name).toHaveValue('Keep provider draft');
      await protocol.click();
      const popup = page.getByRole('listbox');
      await expect(popup).toBeVisible();
      await paintedDialog(page, dialog, theme);
      await expect(popup).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .include('[role="listbox"]')
        .analyze();
      expect(audit.violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
      await expect(protocol).toBeFocused();
      for (const control of [name, protocol]) {
        await control.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        expect((await contrast(control)).focusVisible).toBe(true);
        expect((await contrast(control)).focus).toBeGreaterThanOrEqual(3);
        expect((await contrast(control)).border).toBeGreaterThanOrEqual(3);
        expect((await contrast(control)).text).toBeGreaterThanOrEqual(4.5);
        await control.hover();
        expect((await contrast(control)).border).toBeGreaterThanOrEqual(3);
      }
      const next = dialog.getByRole('button', {
        name: language === 'zh' ? '下一页' : 'Next page',
        exact: true,
      });
      await next.click();
      await expect(dialog.locator('[data-provider-model]').first()).toHaveAttribute(
        'data-provider-model',
        providerModels[10],
      );
      await checkDialogBounds(page, dialog);
      await body.evaluate(element => (element.scrollTop = element.scrollHeight));
      const scroll = await body.evaluate(element => element.scrollTop);
      await changeProviderLanguage(page, language === 'zh' ? 'en' : 'zh');
      const changedCopy = magpieTranslations[language === 'zh' ? 'en' : 'zh'];
      await expect(
        dialog.getByRole('heading', { name: changedCopy.magpieEditProvider, exact: true }),
      ).toBeVisible();
      await expect(dialog.locator('[data-provider-model]').first()).toHaveAttribute(
        'data-provider-model',
        providerModels[10],
      );
      expect(await body.evaluate(element => element.scrollTop)).toBeCloseTo(scroll, -1);
      await changeProviderLanguage(page, language);
      await body.evaluate(element => (element.scrollTop = 0));
      await page.screenshot({ path: `/tmp/companion-provider-${language}-${theme}.png` });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole('button', { name: copy.magpieEditProvider, exact: true }),
      ).toBeFocused();
    });
  }

test('provider model actions keep order, fallback, raw text and keyboard focus', async ({
  page,
}) => {
  const copy = await openProviderSettings(page, 'zh', 'light');
  const dialog = await editProvider(page, copy);
  const next = dialog.getByRole('button', { name: '下一页', exact: true });
  await next.click();
  const preferred = dialog.getByRole('button', {
    name: `${copy.magpieModelSetAsPrimary}: ${providerModels[10]}`,
    exact: true,
  });
  await preferred.focus();
  await preferred.press('Enter');
  await expect(dialog.locator('[data-provider-model]').first()).toHaveAttribute(
    'data-provider-model',
    providerModels[10],
  );
  await expect(preferred).toBeFocused();
  await expect(preferred).toHaveAttribute('aria-pressed', 'true');
  const fallback = dialog.getByRole('button', {
    name: `${copy.magpieModelSetAsFallback}: model-1`,
    exact: true,
  });
  await fallback.press('Space');
  await expect(fallback).toHaveAttribute('aria-pressed', 'true');
  const remove = dialog.getByRole('button', {
    name: `${copy.magpieModelRemove}: model-1`,
    exact: true,
  });
  await remove.press('Enter');
  await expect(
    dialog.getByRole('button', { name: `${copy.magpieModelRemove}: model-2`, exact: true }),
  ).toBeFocused();
  await dialog.getByRole('button', { name: copy.magpieModelModeText, exact: true }).click();
  const text = dialog.getByLabel(copy.magpieProviderModels, { exact: true });
  expect(await text.inputValue()).toBe(
    [
      providerModels[10],
      ...providerModels.filter(model => model !== providerModels[10] && model !== 'model-1'),
    ].join(', '),
  );
  const raw = 'alpha, \nbeta，gamma、alpha';
  await text.fill(raw);
  await expect(text).toHaveValue(raw);
  const fallbackText = dialog.getByLabel(copy.magpieProviderFallback, { exact: true });
  await fallbackText.fill('beta, \ngamma， ');
  await expect(fallbackText).toHaveValue('beta, \ngamma， ');
  await dialog.getByRole('button', { name: copy.magpieModelModeChips, exact: true }).click();
  await expect(dialog.locator('[data-provider-model]')).toHaveCount(3);
  await dialog.getByRole('button', { name: copy.magpieModelModeText, exact: true }).click();
  await expect(text).toHaveValue(raw);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saves = await page.evaluate(() => window.providerEditorFixture.saves);
  expect(saves).toHaveLength(1);
  expect(saves[0].models).toEqual(['alpha', 'beta', 'gamma']);
  expect(saves[0].fallback).toEqual(['beta', 'gamma']);
  expect(saves[0]).not.toHaveProperty('key');
});

for (const resolution of Object.values(ProviderDiscoveryResolution)) {
  test(`provider discovery respects ${resolution} and never overwrites a reopened draft`, async ({
    page,
  }) => {
    const copy = await openProviderSettings(page, 'zh', 'dark', ['original']);
    let dialog = await editProvider(page, copy);
    await dialog.getByRole('button', { name: copy.magpieTestAndDiscover, exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(copy.magpieTestSuccess);
    await expect(
      dialog.getByText(copy.magpieTestAutoFilled.replace('{count}', '2'), { exact: true }),
    ).toHaveCount(0);
    const action = {
      [ProviderDiscoveryResolution.Replace]: copy.magpieModelConflictReplace,
      [ProviderDiscoveryResolution.Append]: copy.magpieModelConflictAppend,
      [ProviderDiscoveryResolution.Keep]: copy.magpieModelConflictKeep,
    }[resolution];
    await dialog.getByRole('button', { name: action, exact: true }).click();
    const expected =
      resolution === ProviderDiscoveryResolution.Replace
        ? ['online-a', 'online-b']
        : resolution === ProviderDiscoveryResolution.Append
          ? ['original', 'online-a', 'online-b']
          : ['original'];
    expect(
      await dialog
        .locator('[data-provider-model]')
        .evaluateAll(rows => rows.map(row => row.dataset.providerModel)),
    ).toEqual(expected);
    await page.evaluate(() => (window.providerEditorFixture.holdTest = true));
    await dialog.getByRole('button', { name: copy.magpieTestAndDiscover, exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: copy.magpieTesting, exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    dialog = await editProvider(page, copy);
    await dialog.getByLabel(copy.magpieProviderName, { exact: true }).fill('New opening');
    await page.evaluate(() =>
      window.providerEditorFixture.heldTests.shift()({ ok: true, discoveredModels: ['stale'] }),
    );
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(dialog.locator('[data-provider-model]')).toHaveCount(1);
    await expect(dialog.getByLabel(copy.magpieProviderName, { exact: true })).toHaveValue(
      'New opening',
    );
  });
}

test('provider save failure retains edits, locks duplicates and keeps invalid URL visible', async ({
  page,
}) => {
  const warnings = [];
  page.on('console', message => {
    if (message.text().startsWith('[ModelSettings]'))
      warnings.push({ type: message.type(), text: message.text() });
  });
  const copy = await openProviderSettings(page, 'en', 'light', ['only-model']);
  const dialog = await editProvider(page, copy);
  const url = dialog.getByLabel(copy.magpieProviderBaseUrl, { exact: true });
  await url.fill('not an endpoint');
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(url).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText(copy.magpieProviderInvalidUrl, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.providerEditorFixture.saves.length)).toBe(0);
  await url.fill('https://edited.example/v1');
  await page.evaluate(() => {
    window.providerEditorFixture.holdSave = true;
    window.providerEditorFixture.failSave = true;
  });
  await save.click();
  await expect(save).toBeDisabled();
  await expect(url).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.providerEditorFixture.saves.length)).toBe(1);
  await page.evaluate(() => window.providerEditorFixture.heldSaves.shift()());
  await expect(dialog.getByText(copy.magpieProviderSaveFailed, { exact: true })).toBeVisible();
  expect(warnings).toEqual([{ type: 'warning', text: '[ModelSettings] request timed out' }]);
  await expect(url).toHaveValue('https://edited.example/v1');
  await page.evaluate(() => {
    window.providerEditorFixture.holdSave = false;
    window.providerEditorFixture.failSave = false;
  });
  await save.click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.providerEditorFixture.saves.length)).toBe(2);
});

test('new provider presets and unedited discovery fill models without stale verdicts', async ({
  page,
}) => {
  const copy = await openProviderSettings(page, 'en', 'dark', []);
  await page.getByRole('button', { name: copy.magpieAddProvider, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.magpieAddProvider, exact: true });
  await expect(dialog).toHaveCSS('opacity', '1');
  const preset = dialog.getByRole('combobox', { name: copy.magpieProviderPreset, exact: true });
  await preset.click();
  await page.getByRole('option', { name: copy.magpiePresetXiaomiTokenPlan, exact: true }).click();
  await expect(preset).toContainText(copy.magpiePresetXiaomiTokenPlan);
  await checkDialogBounds(page, dialog);
  await preset.click();
  await page.getByRole('option', { name: copy.magpiePresetCustom, exact: true }).click();
  await dialog
    .getByLabel(copy.magpieProviderBaseUrl, { exact: true })
    .fill('https://provider.example/v1');
  await dialog.getByRole('button', { name: copy.magpieTestAndDiscover, exact: true }).click();
  await expect(dialog.locator('[data-provider-model]')).toHaveCount(2);
  await expect(
    dialog.getByRole('button', { name: copy.magpieModelConflictReplace, exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText(copy.magpieTestSuccess);
  await dialog
    .getByLabel(copy.magpieProviderBaseUrl, { exact: true })
    .fill('https://other.example/v1');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await page.evaluate(
    () =>
      (window.providerEditorFixture.result = {
        ok: false,
        error: '<html>network error https://private.example/path</html>\n at internal.module',
      }),
  );
  await dialog.getByRole('button', { name: copy.magpieTestAndDiscover, exact: true }).click();
  const error = dialog.getByRole('alert');
  await expect(error).toContainText(copy.magpieTestFailed);
  await expect(error).not.toContainText('private.example');
  await expect(error).not.toContainText('internal.module');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual(
    [],
  );
});

for (const theme of ['light', 'dark']) {
  test(`provider editor combines selected, pressed, invalid and disabled states in ${theme}`, async ({
    page,
  }) => {
    const copy = await openProviderSettings(page, 'en', theme, ['model-1', 'model-2']);
    const dialog = await editProvider(page, copy);
    const preferred = dialog.getByRole('button', {
      name: `${copy.magpieModelSetAsPrimary}: model-1`,
      exact: true,
    });
    await expect(preferred).toHaveAttribute('aria-pressed', 'true');
    await preferred.hover();
    expect((await contrast(preferred)).text).toBeGreaterThanOrEqual(4.5);
    await page.mouse.down();
    await expect(preferred).toHaveCSS('translate', '0px 1px');
    await page.mouse.up();
    await expect(preferred).toHaveCSS('translate', 'none');
    await preferred.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect((await contrast(preferred)).focusVisible).toBe(true);
    expect((await contrast(preferred)).focus).toBeGreaterThanOrEqual(3);
    const add = dialog.getByRole('button', { name: copy.magpieModelAdd, exact: true });
    await expect(add).toBeDisabled();
    await add.hover({ force: true });
    await page.mouse.down();
    await expect(add).toHaveCSS('translate', 'none');
    await page.mouse.up();
    const url = dialog.getByLabel(copy.magpieProviderBaseUrl, { exact: true });
    await url.fill('invalid');
    await url.press('Tab');
    await expect(url).toHaveAttribute('aria-invalid', 'true');
    const error = dialog.getByText(copy.magpieProviderInvalidUrl, { exact: true });
    expect((await contrast(error)).text).toBeGreaterThanOrEqual(4.5);
    await url.focus();
    expect((await contrast(url)).border).toBeGreaterThanOrEqual(3);
    expect((await contrast(url)).focus).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: `/tmp/companion-provider-invalid-${theme}.png` });
    await url.fill('https://provider.example/v1');
    await page.evaluate(
      () => (window.providerEditorFixture.result = { ok: false, requiresKey: true }),
    );
    await dialog.getByRole('button', { name: copy.magpieTestAndDiscover, exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(copy.magpieTestRequiresKey);
    expect(
      (await contrast(dialog.locator('[data-slot="alert-description"]'))).text,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
    ).toEqual([]);
  });
}
