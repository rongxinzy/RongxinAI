/**
 * Installs the browser preview mock as `window.electron` when no preload bridge exists.
 * Imported dynamically from main.tsx behind `import.meta.env.DEV`, so production
 * bundles never include it.
 */
import { CONFIG_KEYS, defaultConfig } from '../config';
import { createBrowserMockElectron } from './index';
import { PreviewLocale, readPreviewLocale } from './previewQuery';

export async function installBrowserMock(): Promise<void> {
  if (typeof window.electron?.platform === 'string') return;
  const previewLocale = readPreviewLocale();
  console.info(
    '[Browser Mock] Installing window.electron mock for browser preview',
    previewLocale ? `(locale=${previewLocale})` : '',
  );
  const electron = createBrowserMockElectron();
  if (previewLocale === PreviewLocale.Chinese || previewLocale === PreviewLocale.English) {
    await electron.store.set(CONFIG_KEYS.APP_CONFIG, {
      ...defaultConfig,
      language: previewLocale,
      language_initialized: true,
    });
  }
  window.electron = electron;
}
