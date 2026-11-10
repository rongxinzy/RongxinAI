import { StrataServiceStatus } from '../../../shared/strata/types';
import type { LlamaCppModelOrchestrator } from '../llamacppModelOrchestrator';
import type { StrataManager } from './strataManager';

export async function releaseGpuForStrata(
  orchestrator: LlamaCppModelOrchestrator | null,
): Promise<void> {
  if (!orchestrator) return;
  const result = await orchestrator.stopAll();
  if (result.runningModels.length || result.modelProcesses.length) {
    throw new Error('Cannot start Strata until the current local models are unloaded.');
  }
}

export async function releaseGpuForLlamaCpp(strataManager: StrataManager | null): Promise<void> {
  if (!strataManager) return;
  const status = await strataManager.stop();
  if (status.status !== StrataServiceStatus.Stopped || status.managedByApp) {
    throw new Error('Cannot load a local model until Strata has stopped.');
  }
}
