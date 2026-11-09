import fs from 'node:fs/promises';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Normal completion and interruption must wait for the same cleanup operation.
export function installSmokeCleanup(cleanup) {
  let cleanupPromise;
  const runCleanup = () => {
    cleanupPromise ??= Promise.resolve().then(cleanup);
    return cleanupPromise;
  };
  for (const [signal, exitCode] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    process.on(signal, () => {
      void runCleanup()
        .catch(error => console.error('[LinuxRendererSmoke] interrupted cleanup failed:', error))
        .finally(() => process.exit(exitCode));
    });
  }
  return runCleanup;
}

// Only use output captured from this launch, never a fixed port or a stale profile file.
export function readBrowserEndpoint(output) {
  const endpoints = [...output.matchAll(/DevTools listening on (\S+)\r?\n/g)].map(
    match => match[1],
  );
  if (endpoints.length === 0) return null;
  if (new Set(endpoints).size !== 1) throw new Error('Ambiguous DevTools browser endpoint');
  const endpoint = endpoints[0];
  if (!/^ws:\/\/127\.0\.0\.1:[1-9]\d*\/devtools\/browser\/[\w-]+$/.test(endpoint)) {
    throw new Error('Invalid local DevTools browser endpoint');
  }
  const parsed = new URL(endpoint);
  if (Number(parsed.port) > 65535) throw new Error('Invalid DevTools port');
  return endpoint;
}

function parseProcessStat(stat) {
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { state: fields[0], group: Number(fields[2]) };
}

export async function verifyBrowserProcess(processInfo, group, nonce) {
  const browsers = processInfo.filter(item => item.type === 'browser');
  const pid = browsers[0]?.id;
  if (browsers.length !== 1 || !Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error('DevTools did not identify exactly one browser process');
  }
  const stat = parseProcessStat(await fs.readFile(`/proc/${pid}/stat`, 'utf8'));
  const environment = await fs.readFile(`/proc/${pid}/environ`, 'utf8');
  if (
    stat.group !== group ||
    !nonce ||
    !environment.split('\0').includes(`ZHIYUAN_LINUX_SMOKE_NONCE=${nonce}`)
  ) {
    throw new Error('DevTools browser does not belong to this smoke launch');
  }
}

async function liveGroupMembers(group) {
  const members = [];
  for (const entry of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = parseProcessStat(await fs.readFile(`/proc/${entry}/stat`, 'utf8'));
      if (stat.group === group && stat.state !== 'Z' && stat.state !== 'X') members.push(entry);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    }
  }
  return members;
}

function signalGroup(group, signal) {
  try {
    process.kill(-group, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export async function stopProcessGroup(group) {
  if (!Number.isSafeInteger(group) || group <= 1) return;
  // xvfb-run can exit before Electron: its exitCode is not a cleanup signal.
  signalGroup(group, 'SIGTERM');
  let deadline = Date.now() + 5_000;
  while ((await liveGroupMembers(group)).length) {
    if (Date.now() >= deadline) break;
    await delay(100);
  }
  if (!(await liveGroupMembers(group)).length) return;
  signalGroup(group, 'SIGKILL');
  deadline = Date.now() + 5_000;
  while ((await liveGroupMembers(group)).length) {
    if (Date.now() >= deadline) throw new Error('Smoke process group did not terminate');
    await delay(100);
  }
}
