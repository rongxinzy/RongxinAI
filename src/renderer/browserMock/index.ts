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
import { createBrowserMockRuntime } from './runtime';

const runtime = createBrowserMockRuntime();

export const browserMockElectron: Window['electron'] = applyOverrides(
  createGeneratedSurface(runtime),
  createInteractiveOverrides(runtime),
);
