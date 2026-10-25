import type { LlamaCppManager } from '../libs/llamacppManager';
import type { LlamaCppModelOrchestrator } from '../libs/llamacppModelOrchestrator';
import type { OllamaManager } from '../libs/ollamaManager';
import type { StrataManager } from '../libs/strata/strataManager';
import type { MagpieManager } from '../magpie/manager';
import type { ManagedMagpieProviderBindings } from '../magpie/managedProviderBindings';

/**
 * Local-inference runtime state carved out of the shared `rt` locator (work
 * package I.1): llama.cpp lifecycle and orchestration, the Ollama manager,
 * and the Magpie gateway with its managed provider bindings. Initialized
 * lazily by initApp; the dispose hooks are wired when the manager starts.
 */
export interface InferenceRuntimeState {
  llamaCppManager: LlamaCppManager | null;
  llamaCppModelOrchestrator: LlamaCppModelOrchestrator | null;
  ollamaManager: OllamaManager | null;
  strataManager: StrataManager | null;
  magpieManager: MagpieManager | undefined;
  managedMagpieBindings: ManagedMagpieProviderBindings | undefined;
  disposeMagpieModels: (() => void) | undefined;
  disposeMagpie: (() => Promise<void>) | undefined;
}

export const inferenceRuntime: InferenceRuntimeState = {
  llamaCppManager: null,
  llamaCppModelOrchestrator: null,
  ollamaManager: null,
  strataManager: null,
  magpieManager: undefined,
  managedMagpieBindings: undefined,
  disposeMagpieModels: undefined,
  disposeMagpie: undefined,
};
