import { LlamaCppBackendError } from '../../shared/llamacpp';
import type { LlamaCppModelOrchestrator } from './llamacppModelOrchestrator';

export async function switchLlamaCppBackend(input: {
  runtime: Pick<LlamaCppModelOrchestrator, 'reconnect' | 'start' | 'stopService'>;
  busy: () => boolean;
  activate: () => void;
  restore: () => void;
}): Promise<void> {
  const { runtime } = input;
  const start = async () => {
    const status = await runtime.start();
    if (status.status !== 'running') {
      throw new Error(status.error || 'Failed to start the selected runtime version.');
    }
  };
  const current = await runtime.reconnect({ requireResponsive: true }).catch(error => {
    throw new Error(LlamaCppBackendError.SwitchRequiresStoppedService, { cause: error });
  });
  if (current?.modelProcesses.length || current?.runningModels.length || input.busy()) {
    throw new Error(LlamaCppBackendError.SwitchRequiresStoppedService);
  }
  if (current) await runtime.stopService({ requireIdle: true });
  try {
    input.activate();
    if (current) await start();
  } catch (error) {
    try {
      if (current) await runtime.stopService();
      input.restore();
      if (current) await start();
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], 'Could not restore the previous runtime.');
    }
    throw error;
  }
}
