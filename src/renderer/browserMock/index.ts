/**
 * Browser preview implementation of `window.electron`.
 *
 * `generated/surface.ts` covers every preload method. Unimplemented calls warn
 * once and return a typed default. `interactive.ts` replaces the calls the main
 * screens need with fixture data and a streamed mock reply.
 */
import { createGeneratedSurface } from './generated/surface';
import { createInteractiveOverrides } from './interactive';
import { applyOverrides } from './merge';
import {
  readPreviewEdition,
  readPreviewLocale,
  readPreviewPlatform,
  readPreviewScenario,
} from './previewQuery';
import { createScenarioOverrides, editionWindowInjection } from './scenarios';
import { createBrowserMockRuntime } from './runtime';
import { createCompanionPreviewApi } from '../companion/previewApi';

const runtime = createBrowserMockRuntime();

function buildBrowserMockElectron(): Window['electron'] {
  editionWindowInjection(readPreviewEdition());
  const scenario = readPreviewScenario();
  const platform = readPreviewPlatform();
  const locale = readPreviewLocale();
  let electron: Window['electron'] = createGeneratedSurface(runtime);
  electron = applyOverrides<Window['electron']>(electron, createInteractiveOverrides(runtime));
  electron = applyOverrides<Window['electron']>(electron, createScenarioOverrides(scenario));
  electron = applyOverrides<Window['electron']>(electron, {
    companion: createCompanionPreviewApi(),
  });
  if (platform) {
    electron = applyOverrides<Window['electron']>(electron, { platform });
  }
  if (locale) {
    electron = applyOverrides<Window['electron']>(electron, {
      appInfo: { getSystemLocale: () => Promise.resolve(locale) },
    });
  }
  return electron;
}

export const browserMockElectron: Window['electron'] = buildBrowserMockElectron();
