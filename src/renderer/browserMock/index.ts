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
import { readPreviewEdition, readPreviewScenario } from './previewQuery';
import { createScenarioOverrides, editionWindowInjection } from './scenarios';
import { createBrowserMockRuntime } from './runtime';

const runtime = createBrowserMockRuntime();

function buildBrowserMockElectron(): Window['electron'] {
  editionWindowInjection(readPreviewEdition());
  const scenario = readPreviewScenario();
  let electron: Window['electron'] = createGeneratedSurface(runtime);
  electron = applyOverrides<Window['electron']>(electron, createInteractiveOverrides(runtime));
  electron = applyOverrides<Window['electron']>(electron, createScenarioOverrides(scenario));
  return electron;
}

/** Built lazily so preview query params (e.g. locale) are read after the page URL is known. */
export function createBrowserMockElectron(): Window['electron'] {
  return buildBrowserMockElectron();
}
