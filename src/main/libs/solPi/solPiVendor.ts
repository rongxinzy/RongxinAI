/**
 * Loader for the vendored SoL-Pi extension (NVlabs/SoL-Pi, MIT).
 *
 * Upstream ships TypeScript with `.ts` import specifiers and expects to be
 * loaded by Pi's jiti-based extension loader. We mirror that loading strategy:
 * the vendor tree is excluded from tsc/oxlint and loaded at runtime through
 * jiti, which resolves the `@earendil-works/*` packages and `typebox` from
 * node_modules — the repo's tree in dev/vitest, the app.asar's production
 * `dependencies` in packaged builds (see README.md "打包路径").
 *
 * Vendor provenance: src/main/libs/solPi/vendor/UPSTREAM_COMMIT pins the
 * reviewed upstream revision; LICENSE.MIT and THIRD_PARTY_NOTICES.md carry
 * the required attribution.
 */
import { existsSync } from 'node:fs';
import { createJiti } from 'jiti';
import path from 'node:path';

/**
 * Structural slice of the vendored SolPiRuntimeOptions (index.ts). Defined
 * locally, like the other shapes below, so this module keeps avoiding Pi
 * type declarations: only the fields the app actually threads are mirrored.
 */
export interface SolPiVendorOptions {
  bashOptions?: { shellPath?: string; commandPrefix?: string };
  archiveBudgetBytes?: number;
}

/** Structural shape of the vendored SoL-Pi entry module (index.ts). */
export interface SolPiVendorModule {
  createSolPiExtension: (
    loadConfig: (ctx: SolPiVendorExtensionContext) => SolPiVendorConfig,
    options?: SolPiVendorOptions,
  ) => (pi: unknown) => void;
  registerConfiguredFeatures: (
    pi: unknown,
    config: SolPiVendorConfig,
    options?: SolPiVendorOptions,
  ) => void;
}

/**
 * Minimal slice of Pi's ExtensionContext that SoL-Pi's config loader receives.
 * Kept local so this module does not depend on Pi type declarations.
 */
export interface SolPiVendorExtensionContext {
  cwd: string;
  isProjectTrusted: () => boolean;
}

/** Effective SoL-Pi configuration (schema version 1; all features opt-in). */
export interface SolPiVendorConfig {
  version: 1;
  actionFusion: boolean;
  observationPack: boolean;
  evidencePreservingReducer: boolean;
  evidencePreservingReducerModel: string;
  evidencePreservingReducerProvider: string;
  onlineContextCompact: boolean;
  cacheWriteReadRatio: number;
}

let vendorModulePromise: Promise<SolPiVendorModule> | null = null;

/**
 * Absolute path of the vendored SoL-Pi entry, resolved for the executing
 * layout. Exported for packaged-app verification (the packaged smoke must
 * prove resolution stays inside the app bundle, never a source checkout).
 */
export function resolveSolPiVendorEntry(): string {
  // The Electron main process is a single CJS bundle at dist-electron/main.js
  // (vite/rolldown, also in `electron:dev`), so __dirname is the bundle
  // directory in every packaged or development run:
  //  - packaged app: <app.asar>/dist-electron, vendor packed at the archive
  //    root next to node_modules so jiti's node resolution finds the shared
  //    @earendil-works packages;
  //  - dev checkout: <repo>/dist-electron, vendor in the source tree.
  // The tsc output layout (dist-electron/libs/solPi) and vitest/source
  // execution keep the legacy candidates below.
  const candidates = [
    path.resolve(__dirname, '../solpi-vendor/sol-pi/index.ts'),
    path.resolve(__dirname, '../src/main/libs/solPi/vendor/sol-pi/index.ts'),
    path.resolve(__dirname, '../../../src/main/libs/solPi/vendor/sol-pi/index.ts'),
    path.resolve(__dirname, '../../../../solpi-vendor/sol-pi/index.ts'),
    path.resolve(__dirname, 'vendor/sol-pi/index.ts'),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0] ?? '';
}

/**
 * Load the vendored SoL-Pi entry module once per process. jiti keeps the
 * vendor's own module graph (`.ts` specifiers) intact and shares bare-specifier
 * resolution with this repo's node_modules.
 */
export function loadSolPiVendor(): Promise<SolPiVendorModule> {
  if (!vendorModulePromise) {
    vendorModulePromise = (async (): Promise<SolPiVendorModule> => {
      const entry = resolveSolPiVendorEntry();
      const jiti = createJiti(__filename, { moduleCache: true });
      const loaded = (await jiti.import(entry)) as Partial<SolPiVendorModule>;
      if (typeof loaded.createSolPiExtension !== 'function') {
        throw new Error(`SoL-Pi vendor entry did not export a factory: ${entry}`);
      }
      return loaded as SolPiVendorModule;
    })();
    vendorModulePromise.catch(() => {
      // Allow a later retry after a transient failure (e.g. missing vendor dir).
      vendorModulePromise = null;
    });
  }
  return vendorModulePromise;
}
