/**
 * Public entry for llama.cpp backend management.
 * Implementation split under ./llamacppBackendManager (issue #1069).
 */
export { buildFallbackManifest } from './llamacppFallbackManifest';
export type { LlamaCppBackendSelectionInput } from './llamacppBackendManager/catalog';
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
