import { classifyCoworkError, type CoworkError } from '../../common/coworkError';
import {
  WorkbenchRunTrigger,
  type WorkbenchRun,
  type WorkbenchTask,
} from '../../shared/workbenchTask';
import type { WorkbenchTaskService } from './taskService';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';

/** Observe asynchronous dispatch failures without blocking the retry IPC for a whole run. */
export function observePreparedRun(
  start: () => Promise<void>,
  task: WorkbenchTask,
  run: WorkbenchRun,
  options: {
    service: Pick<WorkbenchTaskService, 'pauseRun' | 'failRun'> & {
      repository: Pick<WorkbenchTaskService['repository'], 'getActiveTaskForSession'>;
    };
    runtime: Pick<PiRuntimeAdapter, 'on' | 'off' | 'emit'>;
  },
): void {
  let reported = false;
  const onError = (sessionId: string, _error: CoworkError) => {
    if (sessionId === task.sessionId) reported = true;
  };
  options.runtime.on('error', onError);
  void Promise.resolve()
    .then(start)
    .catch(error => {
      const current = options.service.repository.getActiveTaskForSession(task.sessionId);
      // A stopped or superseded attempt must never fail its replacement.
      if (current?.id !== task.id || current.activeRunId !== run.id) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[WorkbenchTask] Prepared run failed:', error);
      try {
        if (run.trigger === WorkbenchRunTrigger.Resume) {
          options.service.pauseRun(task.sessionId, message);
        } else {
          options.service.failRun(task.sessionId, { message });
        }
      } catch (persistenceError) {
        console.error('[WorkbenchTask] Failed to persist prepared run failure:', persistenceError);
      }
      // The runtime normally emits this itself; initialization can fail before its catch boundary.
      if (!reported) options.runtime.emit('error', task.sessionId, classifyCoworkError(message));
    })
    .finally(() => options.runtime.off('error', onError))
    .catch(error => console.error('[WorkbenchTask] Failed to report prepared run failure:', error));
}
