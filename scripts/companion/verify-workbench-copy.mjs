import { expect } from '@playwright/test';
import path from 'node:path';
import { magpieTranslations } from '../../src/renderer/services/magpieTranslations.ts';

async function verifyNativeModelCopy(main, output) {
  const language = (await main.locator('html').getAttribute('lang')).startsWith('zh') ? 'zh' : 'en';
  const copy = magpieTranslations[language];
  await main
    .getByText(language === 'zh' ? '登录' : 'Login', { exact: true })
    .first()
    .click();
  await main
    .getByRole('menuitem', { name: language === 'zh' ? '设置' : 'Settings', exact: true })
    .click();
  const label = language === 'zh' ? '模型' : 'Model';
  await main.getByRole('button', { name: label, exact: true }).click();
  const region = main.getByRole('region', { name: label, exact: true });
  await expect(region.getByText(copy.magpieCatalogHint, { exact: true })).toBeVisible();
  const catalog = await main.evaluate(() => window.electron.magpie.catalog());
  expect(catalog.status.state).toBe('running');
  expect(catalog.models.some(model => model.id === catalog.defaultModelId)).toBe(true);
  const search = region.getByRole('searchbox');
  await search.fill('fixture-model');
  await search.focus();
  for (const theme of ['light', 'dark']) {
    await main.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(main.locator('html')).toHaveClass(new RegExp(theme));
    await expect
      .poll(() =>
        region.evaluate(element => {
          for (let surface = element; surface; surface = surface.parentElement) {
            const color = getComputedStyle(surface).backgroundColor;
            if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
          }
          return null;
        }),
      )
      .toBe(theme === 'dark' ? 'rgb(24, 25, 29)' : 'rgb(255, 255, 255)');
    await expect(search).toHaveValue('fixture-model');
    await expect(search).toBeFocused();
    await main.screenshot({ path: path.join(output, `model-copy-${theme}.png`) });
  }
  const sections = region.getByRole('combobox', { name: copy.magpieSettingsSections, exact: true });
  if (await sections.count()) {
    await sections.click();
    await main.getByRole('option', { name: copy.magpieSectionAdvanced, exact: true }).click();
  } else await region.getByRole('tab', { name: copy.magpieSectionAdvanced, exact: true }).click();
  await expect(region.getByText(copy.magpieRedactSecretsHint, { exact: true })).toBeVisible();
  await main
    .getByRole('button', { name: language === 'zh' ? '关闭' : 'Close', exact: true })
    .click();
  return {
    language,
    realCatalog: true,
    retainedSearchAndFocus: true,
    copyFromCurrentSettings: true,
  };
}

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
  const modelSettings = await verifyNativeModelCopy(main, output);
  await expect(main.getByRole('textbox').last()).toHaveText(draft);
  return { metrics, nativeBridge: true, retainedDraft: true, restoredFocus: true, modelSettings };
}
