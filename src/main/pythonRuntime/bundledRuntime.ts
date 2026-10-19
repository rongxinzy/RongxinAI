/**
 * Version identity of the bundled managed runtime (work package G).
 *
 * These mirror the defaults of scripts/setup-python-runtime.js,
 * scripts/setup-mac-python-runtime.js, scripts/setup-uv-runtime.js and
 * scripts/setup-mac-uv-runtime.js (their env overrides are dev-only —
 * shipped artifacts always carry these versions). The runner never
 * downloads a runtime; this id changes whenever the bundled pair changes so
 * existing workspace environments demand an explicit rebuild.
 */
export const BUNDLED_PYTHON_VERSION = '3.14.6';
export const BUNDLED_UV_VERSION = '0.11.32';

export const bundledRuntimeId = (): string =>
  `bundled-cpython-${BUNDLED_PYTHON_VERSION}-uv-${BUNDLED_UV_VERSION}`;
