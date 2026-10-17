/**
 * Public entry for llama.cpp backend management.
 * Implementation split under ./llamacppBackendManager (issue #1069).
 */
import type { LlamaCppServiceConfig } from '../../shared/llamacpp';

export { buildFallbackManifest } from './llamacppFallbackManifest';

export type LlamaCppBackendSelectionInput = {
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  config?: LlamaCppServiceConfig;
};
export {
  buildVersionBackend,
  toBackendRef,
  getLlamaCppBackendsRoot,
  getLlamaCppBackendDir,
  getLlamaCppCurrentBackendDir,
  getLlamaCppBackendExecutablePath,
  getLlamaCppCurrentExecutablePath,
  readCurrentBackendRef,
  readBackendBuildInfo,
  syncCurrentBackend,
  listInstalledBackendRefs,
} from './llamacppBackendManager/paths';
export {
  fetchLlamaCppBackendManifest,
  listLlamaCppBackends,
  resolveLlamaCppBackendDownloadSize,
  getLlamaCppBackendCompatibilityError,
  recommendLlamaCppBackend,
} from './llamacppBackendManager/catalog';
export {
  installLlamaCppBackend,
  uninstallLlamaCppBackend,
  importLlamaCppBackendArchive,
  importLlamaCppBackendPath,
} from './llamacppBackendManager/install';
