import type { LlamaCppModelOrchestrator } from '../llamacppModelOrchestrator';
import type { StrataManager } from './strataManager';

export async function releaseGpuForStrata(
  orchestrator: LlamaCppModelOrchestrator | null,
): Promise<void> {
  if (!orchestrator) return;
  try {
    await orchestrator.stopAll();
  } catch (error) {
    console.warn('[Strata] Failed to unload llama.cpp models before Strata start:', error);
  }
}

export async function releaseGpuForLlamaCpp(strataManager: StrataManager | null): Promise<void> {
  if (!strataManager) return;
  try {
    await strataManager.stop();
  } catch (error) {
    console.warn('[Strata] Failed to stop Strata before llama.cpp GPU load:', error);
  }
}
