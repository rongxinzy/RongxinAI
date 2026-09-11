/**
 * Loader for the vendored SoL-Pi extension (NVlabs/SoL-Pi, MIT).
 *
 * Upstream ships TypeScript with `.ts` import specifiers and expects to be
 * loaded by Pi's jiti-based extension loader. We mirror that loading strategy:
 * the vendor tree is excluded from tsc/oxlint and loaded at runtime through
 * jiti, which resolves the shared `@earendil-works/*` packages from this
 * repo's node_modules (same ESM instances the adapter's dynamic imports use).
 *
 * Vendor provenance: src/main/libs/solPi/vendor/UPSTREAM_COMMIT pins the
 * reviewed upstream revision; LICENSE.MIT and THIRD_PARTY_NOTICES.md carry
 * the required attribution.
 */
import { existsSync } from 'node:fs';
import { createJiti } from 'jiti';
import path from 'node:path';

/** Structural shape of the vendored SoL-Pi entry module (index.ts). */
export interface SolPiVendorModule {
  createSolPiExtension: (
    loadConfig: (ctx: SolPiVendorExtensionContext) => SolPiVendorConfig,
  ) => (pi: unknown) => void;
  registerConfiguredFeatures: (pi: unknown, config: SolPiVendorConfig) => void;
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

function resolveVendorEntry(): string {
  // Compiled main process: dist-electron/libs/solPi/ -> <repo>/src/main/libs/solPi/vendor.
  // Vitest / source execution: src/main/libs/solPi/ -> vendor sibling directory.
  const candidates = [
    path.resolve(__dirname, '../../../src/main/libs/solPi/vendor/sol-pi/index.ts'),
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
      const entry = resolveVendorEntry();
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
