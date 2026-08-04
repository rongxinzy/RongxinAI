import type { ProductionLoopState } from '../../shared/productionLoop';
import type { ProductionLoopStore } from '../productionLoop/ports';

const clone = (state: ProductionLoopState): ProductionLoopState => structuredClone(state);

export class InMemoryProductionLoopStore implements ProductionLoopStore {
  private readonly states = new Map<string, ProductionLoopState>();

  transaction<T>(operation: () => T): T {
    return operation();
  }

  create(state: ProductionLoopState): ProductionLoopState {
    if (this.states.has(state.runId))
      throw new Error(`Production loop already exists: ${state.runId}`);
    this.states.set(state.runId, clone(state));
    return clone(state);
  }

  get(runId: string): ProductionLoopState | null {
    const state = this.states.get(runId);
    return state ? clone(state) : null;
  }

  getLatestForTask(taskId: string, excludeRunId?: string): ProductionLoopState | null {
    const states = [...this.states.values()]
      .filter(state => state.taskId === taskId && state.runId !== excludeRunId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return states[0] ? clone(states[0]) : null;
  }

  update(state: ProductionLoopState): ProductionLoopState {
    if (!this.states.has(state.runId)) throw new Error(`Production loop not found: ${state.runId}`);
    const next = { ...clone(state), updatedAt: Date.now() };
    this.states.set(next.runId, next);
    return clone(next);
  }

  deleteForSession(_sessionId: string): void {
    this.states.clear();
  }
}
