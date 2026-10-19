import bundled from './bundledRuntime.json';

/**
 * Version identity of the bundled managed runtime (work package G). The
 * values live in bundledRuntime.json so plain-Node build scripts can read
 * them too (electron-builder hooks require the setup scripts in-process).
 * They mirror the defaults of the four scripts/setup-*-runtime scripts; the
 * scripts' env overrides are dev-only — shipped artifacts always carry these
 * versions. The runner never downloads a runtime; the id changes whenever the
 * bundled pair changes so existing workspace environments demand an explicit
 * rebuild.
 */
export const BUNDLED_PYTHON_VERSION: string = bundled.pythonVersion;
export const BUNDLED_UV_VERSION: string = bundled.uvVersion;

export const bundledRuntimeId = (): string =>
  `bundled-cpython-${BUNDLED_PYTHON_VERSION}-uv-${BUNDLED_UV_VERSION}`;
