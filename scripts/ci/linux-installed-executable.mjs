import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { installedExecutable } from './linux-release-acceptance-lib.mjs';

// A bundled Python environment makes dpkg's file list much larger than the
// execFileSync default buffer. Stream it and retain only executable candidates.
export async function queryInstalledExecutable(
  packageName,
  executableName,
  launch = spawn,
  { timeoutMs = 180_000, killGraceMs = 1_000 } = {},
) {
  const child = launch('dpkg-query', ['-L', packageName], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let timedOut = false;
  let killTimer;
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (timedOut) reject(new Error('dpkg-query file listing timed out'));
      else if (code === 0 && !signal) resolve();
      else reject(new Error(`dpkg-query file listing failed: code=${code}, signal=${signal}`));
    });
  });
  // Attach a handler immediately; stream completion may follow a process error.
  completion.catch(() => {});
  function stopChild() {
    if (child.exitCode !== null || child.signalCode !== null || killTimer) return;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
  }
  const timer = setTimeout(() => {
    timedOut = true;
    stopChild();
  }, timeoutMs);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const candidates = [];
  try {
    for await (const line of lines) {
      if (line.startsWith('/opt/') && line.endsWith(`/${executableName}`)) {
        candidates.push(line);
        if (candidates.length > 1) throw new Error('Installed executable path is ambiguous');
      }
    }
    await completion;
    return installedExecutable(candidates, executableName);
  } finally {
    clearTimeout(timer);
    lines.close();
    stopChild();
    await completion.catch(() => {});
    clearTimeout(killTimer);
  }
}
