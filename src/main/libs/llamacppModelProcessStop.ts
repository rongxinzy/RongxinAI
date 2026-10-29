import type { ChildProcess } from 'node:child_process';

const LLAMACPP_MODEL_STOP_GRACE_MS = 1_000;
const LLAMACPP_MODEL_FORCE_STOP_GRACE_MS = 1_000;
export const LLAMACPP_MODEL_STOP_TIMEOUT_MS =
  LLAMACPP_MODEL_STOP_GRACE_MS + LLAMACPP_MODEL_FORCE_STOP_GRACE_MS;

/** Terminate only the owned child; successful signalling is not proof of exit. */
export async function stopLlamaCppModelProcess(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return;
  if (await signalAndWait(child, 'SIGTERM', LLAMACPP_MODEL_STOP_GRACE_MS)) return;
  if (await signalAndWait(child, 'SIGKILL', LLAMACPP_MODEL_FORCE_STOP_GRACE_MS)) return;
  throw new Error('Local model process did not exit after SIGTERM and SIGKILL.');
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalAndWait(
  child: ChildProcess,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
    };
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(hasExited(child));
    }, timeoutMs);
    child.once('exit', onExit);
    try {
      child.kill(signal);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
