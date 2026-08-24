import type {
  LlamaCppInstallProgress,
  LlamaCppRuntimeInstallSnapshot,
} from '../../shared/llamacpp';

const terminalInstallPhases = new Set<LlamaCppInstallProgress['phase']>([
  'done',
  'failed',
  'cancelled',
  'needs-manual',
]);

export function createLlamaCppRuntimeInstallState() {
  let active = false;
  let progress: LlamaCppInstallProgress | undefined;

  return {
    start(): void {
      active = true;
    },
    update(nextProgress: LlamaCppInstallProgress): void {
      progress = nextProgress;
      if (terminalInstallPhases.has(nextProgress.phase)) active = false;
    },
    finish(): void {
      active = false;
    },
    snapshot(): LlamaCppRuntimeInstallSnapshot {
      // A restored view only needs in-flight work; terminal results are delivered as live events.
      return active ? { active, progress } : { active: false };
    },
  };
}
