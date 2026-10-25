import { expect } from '@playwright/test';
import { magpieTranslations } from '../../../src/renderer/services/magpieTranslations.ts';

export const providerModels = Array.from({ length: 23 }, (_, index) =>
  index === 10 ? `long-model-${'readable-identifier-'.repeat(12)}` : `model-${index + 1}`,
);

/** Synthetic settings receipts only; never reads saved credentials or sends network requests. */
export async function openProviderSettings(page, language, theme, models = providerModels) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ language, models }) => {
      let api;
      Object.defineProperty(window, 'electron', {
        configurable: true,
        get: () => api,
        set(value) {
          const fixture = {
            providers: [
              {
                id: 'editor-fixture',
                name: 'Preview provider',
                api: 'openai-completions',
                baseUrl: 'https://provider.example/v1',
                models,
                fallback: ['model-2'],
                off: false,
                hasKey: false,
                isHostManaged: false,
              },
            ],
            saves: [],
            tests: [],
            heldTests: [],
            heldSaves: [],
            holdTest: false,
            holdSave: false,
            failSave: false,
            result: { ok: true, latencyMs: 42, discoveredModels: ['online-a', 'online-b'] },
          };
          window.providerEditorFixture = fixture;
          value.magpie.providers = async () => fixture.providers;
          value.magpie.testProvider = async input => {
            fixture.tests.push({ ...input });
            if (fixture.holdTest) return new Promise(resolve => fixture.heldTests.push(resolve));
            return fixture.result;
          };
          value.magpie.saveProvider = async input => {
            fixture.saves.push({ ...input });
            if (fixture.holdSave) await new Promise(resolve => fixture.heldSaves.push(resolve));
            if (fixture.failSave) throw new Error('request timed out');
            fixture.providers = [{ ...fixture.providers[0], ...input }];
            return fixture.providers;
          };
          value.appInfo.getSystemLocale = async () => (language === 'zh' ? 'zh-CN' : 'en-US');
          const get = value.store.get;
          value.store.get = async key =>
            key === 'app_config'
              ? { ...(await get(key)), language, theme: 'system', language_initialized: true }
              : get(key);
          api = value;
        },
      });
    },
    { language, models },
  );
  await page.goto('/?previewSkipBoot=1');
  await expect(page).toHaveTitle('ZhiYuan Agent');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page
    .getByText(language === 'zh' ? '登录' : 'Login', { exact: true })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: language === 'zh' ? '设置' : 'Settings', exact: true })
    .click();
  await page
    .getByRole('button', { name: language === 'zh' ? '模型' : 'Model', exact: true })
    .click();
  return magpieTranslations[language];
}

export async function editProvider(page, copy) {
  await page.getByRole('button', { name: copy.magpieEditProvider, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName(copy.magpieEditProvider);
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog.getByLabel(copy.magpieProviderName, { exact: true })).toBeFocused();
  return dialog;
}

export async function paintedDialog(page, dialog, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
  await expect(dialog).toHaveCSS(
    'background-color',
    theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(37, 39, 47)',
  );
}

export async function checkDialogBounds(page, dialog) {
  const metrics = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const body = element.querySelector('[data-slot="field-group"]').parentElement;
    const footer = element.querySelector('[data-slot="dialog-footer"]').getBoundingClientRect();
    return {
      width: rect.width,
      top: rect.top,
      bottom: rect.bottom,
      noOverflow:
        element.scrollWidth <= element.clientWidth && body.scrollWidth <= body.clientWidth,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      footerVisible:
        footer.top >= rect.top && footer.bottom <= rect.bottom && footer.bottom <= innerHeight,
      smallType: [
        ...element.querySelectorAll(
          'button, label, input, textarea, [data-slot="field-description"]',
        ),
      ]
        .filter(node => node.getBoundingClientRect().height > 0)
        .filter(node => Number.parseFloat(getComputedStyle(node).fontSize) < 14)
        .map(node => node.tagName),
      shortControls: [...element.querySelectorAll('button,input:not([aria-hidden="true"])')]
        .filter(
          node =>
            node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().height < 28,
        )
        .map(node => node.tagName),
    };
  });
  expect(metrics.width).toBeGreaterThanOrEqual(Math.min(448, page.viewportSize().width - 32));
  expect(metrics.top).toBeGreaterThanOrEqual(15);
  expect(metrics.bottom).toBeLessThanOrEqual(page.viewportSize().height - 15);
  expect(metrics.noOverflow).toBe(true);
  expect(metrics.footerVisible).toBe(true);
  expect(metrics.smallType).toEqual([]);
  expect(metrics.shortControls).toEqual([]);
  return metrics;
}

export async function changeProviderLanguage(page, language) {
  if (!['zh', 'en'].includes(language)) throw new Error('Unsupported fixture language');
  await page.addScriptTag({
    type: 'module',
    content: `
    import { i18nService } from '/src/renderer/services/i18n.ts';
    i18nService.setLanguage('${language}', { persist: false });
  `,
  });
}
