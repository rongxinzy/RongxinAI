import type { HarnessActivationEvent } from '../../shared/harness';
import type { ProductionLoopState } from '../../shared/productionLoop';

export interface ProductionLoopStore {
  transaction<T>(operation: () => T): T;
  create(state: ProductionLoopState): ProductionLoopState;
  get(runId: string): ProductionLoopState | null;
  getLatestForTask(taskId: string, excludeRunId?: string): ProductionLoopState | null;
  update(state: ProductionLoopState): ProductionLoopState;
  deleteForSession(sessionId: string): void;
}

export interface ProductionLoopMeasurement {
  recordActivation(runId: string, event: HarnessActivationEvent): void;
}
