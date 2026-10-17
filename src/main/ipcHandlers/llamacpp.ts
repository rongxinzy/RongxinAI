/**
 * Public entry for llama.cpp IPC handlers.
 * Implementation split under ./llamacpp (issue #1069).
 */
export {
  broadcastLlamaCppModelResidencyState,
  getLlamaCppLoadedModelLimitViolation,
  getRequiredVramRecoveryMiB,
  getTotalFreeVramMiB,
  hasRecoveredVram,
  waitForLlamaCppModelUnloadConfirmation,
  waitForLlamaCppStartupModelBindings,
} from './llamacpp/helpers';
export {
  enforceLlamaCppParallelTwo,
  getLlamaCppModelPreferences,
  getLlamaCppServiceConfig,
  sanitizeLlamaCppModelPreference,
  sanitizeLlamaCppServiceConfig,
  shouldRefreshLlamaCppModelBindings,
} from './llamacpp/config';
export { registerLlamaCppIpcHandlers } from './llamacpp/registerHandlers';
