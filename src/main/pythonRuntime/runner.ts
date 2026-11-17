import { startPosixProcessSupervisor } from './process';
import { runPythonOperation } from './runtime';
import type { PythonRunnerRequest, PythonRunnerResponse } from '../../shared/pythonRuntime';
import { PythonRuntimeOperation } from '../../shared/pythonRuntime/constants';

if (process.argv[2] === '--python-process-supervisor') {
  startPosixProcessSupervisor();
} else {
  process.env.ZHIYUAN_PYTHON_RUNNER_ENTRY = process.argv[1];
  const controller = new AbortController();
  let started = false;
  process.on('disconnect', () => {
    controller.abort(new Error('The application closed.'));
  });
  process.on('message', (message: PythonRunnerRequest | { cancel: true }) => {
    if ('cancel' in message) {
      controller.abort(new Error('Python operation cancelled.'));
      return;
    }
    if (started) return;
    started = true;
    const requested =
      message.input.timeoutMs ??
      (message.operation === PythonRuntimeOperation.Install || message.input.skill
        ? 300_000
        : 60_000);
    const timeout = setTimeout(
      () => controller.abort(new Error('Python operation timed out.')),
      Math.max(
        100,
        Math.min(
          requested,
          'scriptPath' in message.input || message.input.skill ? 900_000 : 600_000,
        ),
      ),
    );
    void runPythonOperation(message, controller.signal).then(
      result => finish({ success: true, result }),
      error =>
        finish({ success: false, error: error instanceof Error ? error.message : String(error) }),
    );
    function finish(result: PythonRunnerResponse) {
      clearTimeout(timeout);
      if (process.connected) process.send?.(result, () => process.disconnect());
    }
  });
}
