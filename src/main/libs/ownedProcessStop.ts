import { execFile, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { settleWithin } from './startupGate';

type OwnedProcess = Pick<
  ChildProcess,
  'once' | 'removeListener' | 'kill' | 'exitCode' | 'signalCode'
>;

const OWNED_PROCESS_STOP_GRACE_MS = 1_000;
const OWNED_PROCESS_FORCE_STOP_GRACE_MS = 1_000;
const WINDOWS_TREE_STOP_TIMEOUT_MS = 1_000;
export const OWNED_PROCESS_STOP_TIMEOUT_MS =
  OWNED_PROCESS_STOP_GRACE_MS + OWNED_PROCESS_FORCE_STOP_GRACE_MS;

/** Terminate only the owned child; successful signalling is not proof of exit. */
export async function stopOwnedProcess(
  child: OwnedProcess,
  signalProcess: (signal: NodeJS.Signals) => void = signal => {
    child.kill(signal);
  },
): Promise<void> {
  if (hasExited(child)) return;
  if (await signalAndWait(child, signalProcess, 'SIGTERM', OWNED_PROCESS_STOP_GRACE_MS)) return;
  if (await signalAndWait(child, signalProcess, 'SIGKILL', OWNED_PROCESS_FORCE_STOP_GRACE_MS))
    return;
  throw new Error('Owned process did not exit after SIGTERM and SIGKILL.');
}

function hasExited(child: OwnedProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalAndWait(
  child: OwnedProcess,
  signalProcess: (signal: NodeJS.Signals) => void,
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
      signalProcess(signal);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

type ProcessTreeChild = OwnedProcess & Pick<ChildProcess, 'pid'>;

interface ProcessTreeTerminationOptions {
  platform?: NodeJS.Platform;
  terminateWindowsTree?: (pid: number) => Promise<void>;
}

const terminateWindowsTree = async (pid: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: WINDOWS_TREE_STOP_TIMEOUT_MS },
      error => (error ? reject(error) : resolve()),
    );
  });
};

export const terminateProcessTree = async (
  child: ProcessTreeChild,
  options: ProcessTreeTerminationOptions = {},
): Promise<void> => {
  const pid = child.pid;
  if (!pid) return;

  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    try {
      await settleWithin(
        (options.terminateWindowsTree ?? terminateWindowsTree)(pid),
        WINDOWS_TREE_STOP_TIMEOUT_MS,
      );
    } catch {
      // A failed tree command cannot prevent direct termination of the owned child.
    }
    await stopOwnedProcess(child);
    return;
  }

  let forcedGroupStop = false;
  await stopOwnedProcess(child, signal => {
    try {
      process.kill(-pid, signal);
      forcedGroupStop = signal === 'SIGKILL';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      child.kill(signal);
    }
  });
  if (forcedGroupStop) return;
  // A child can exit while its descendants still ignore the graceful signal.
  for (let attempt = 0; ; attempt++) {
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return;
      if (platform !== 'darwin' || code !== 'EPERM' || attempt > 0) throw error;
      // Darwin can return EPERM while the only remaining group members are zombies.
      await delay(50);
    }
  }
};
