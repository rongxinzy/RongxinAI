import { LlamaCppBackendError } from '../../shared/llamacpp';
import type {
  LlamaCppRunningModel,
  LlamaCppServerStatus,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';

export const LlamaCppBackendSwitchServiceStatus = {
  Running: 'running',
  Starting: 'starting',
  Stopped: 'stopped',
} as const;

type LlamaCppBackendSwitchPreparation =
  | { success: true; restartService: boolean }
  | { success: false; error: string };

type LlamaCppBackendSwitchRestartResult =
  | { success: true }
  | { success: false; error: string };

function isServiceActive(status: LlamaCppServerStatus): boolean {
  return (
    status === LlamaCppBackendSwitchServiceStatus.Running ||
    status === LlamaCppBackendSwitchServiceStatus.Starting
  );
}

function blockedSwitch(): LlamaCppBackendSwitchPreparation {
  return { success: false, error: LlamaCppBackendError.SwitchRequiresStoppedService };
}

export async function prepareLlamaCppBackendVersionSwitch(input: {
  serviceStatus: LlamaCppServerStatus;
  listRunningModels: () => Promise<LlamaCppRunningModel[]>;
  stop: () => Promise<LlamaCppStatusSnapshot>;
}): Promise<LlamaCppBackendSwitchPreparation> {
  if (!isServiceActive(input.serviceStatus)) {
    return { success: true, restartService: false };
  }

  try {
    const runningModels = await input.listRunningModels();
    if (runningModels.length > 0) return blockedSwitch();

    const stoppedStatus = await input.stop();
    return isServiceActive(stoppedStatus.status)
      ? blockedSwitch()
      : { success: true, restartService: true };
  } catch {
    // Keep the active service untouched when its model state cannot be confirmed.
    return blockedSwitch();
  }
}

export async function restartLlamaCppBackendVersionService(input: {
  start: () => Promise<LlamaCppStatusSnapshot>;
}): Promise<LlamaCppBackendSwitchRestartResult> {
  try {
    const status = await input.start();
    if (status.status === LlamaCppBackendSwitchServiceStatus.Running) {
      return { success: true };
    }
    return { success: false, error: status.error || 'Failed to start the selected runtime version.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
