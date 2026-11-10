/**
 * Browser preview implementation of `window.electron`.
 *
 * `generated/surface.ts` covers every preload method. Unimplemented calls warn
 * once and return a typed default. `interactive.ts` replaces the calls the main
 * screens need with fixture data and a streamed mock reply.
 */
import { createGeneratedSurface } from './generated/surface';
import { createInteractiveOverrides } from './interactive';
import { createEditionOverrides } from './editions';
import { applyOverrides } from './merge';
import {
  PreviewEdition,
  readPreviewEdition,
  readPreviewLocale,
  readPreviewPlatform,
  readPreviewScenario,
} from './previewQuery';
import { createScenarioOverrides, editionWindowInjection } from './scenarios';
import { createBrowserMockRuntime } from './runtime';

const runtime = createBrowserMockRuntime();

function buildBrowserMockElectron(): Window['electron'] {
  const edition = readPreviewEdition();
  editionWindowInjection(edition);
  const scenario = readPreviewScenario();
  const platform = readPreviewPlatform();
  const locale = readPreviewLocale();
  let electron: Window['electron'] = createGeneratedSurface(runtime);
  electron = applyOverrides<Window['electron']>(electron, createInteractiveOverrides(runtime));
  electron = applyOverrides<Window['electron']>(electron, createScenarioOverrides(scenario));
  electron = applyOverrides<Window['electron']>(electron, createEditionOverrides(edition));
  if (platform) {
    electron = applyOverrides<Window['electron']>(electron, { platform });
  }
  if (locale) {
    electron = applyOverrides<Window['electron']>(electron, {
      appInfo: { getSystemLocale: () => Promise.resolve(locale) },
    });
  }
  if (edition === PreviewEdition.Defense) Reflect.deleteProperty(electron, 'appUpdate');
  return electron;
}

export const browserMockElectron: Window['electron'] = buildBrowserMockElectron();
