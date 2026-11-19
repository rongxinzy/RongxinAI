import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

if (process.platform !== 'win32' || !process.env.RUNNER_TEMP) throw Error('Windows CI required');
const [argument, mode] = process.argv.slice(2);
const execute = promisify(execFile);
const source = path.resolve(argument);
const root = path.join(process.env.RUNNER_TEMP, `desktop-pet-repro-${process.pid}`);
const evidence = path.resolve('desktop-pet-repro-evidence');
mkdirSync(root, { recursive: true });
mkdirSync(evidence, { recursive: true });
const { Cdp } = await import(pathToFileURL(path.resolve('scripts/ci/windows-shell-browser-evidence.mjs')));

function launch(exe, args, env) {
  const child = spawn(exe, args, { env, windowsHide: false });
  let output = '';
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-180_000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-180_000); });
  child.on('error', error => { output += String(error); });
  return { child, output: () => output };
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10_000 }).catch(() => child.kill());
}

async function waitFor(probe, label, attempts = 80) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(400);
  }
  throw new Error(`${label} timed out${last ? `: ${last}` : ''}`);
}

async function install() {
  const installDir = path.join(root, '安装路径');
  const log = path.join(evidence, 'installer-events.jsonl');
  const setup = launch(source, [
    '--auto-install', '--skip-registration',
    '--install-dir', installDir,
    '--runtime-root', path.join(root, 'runtime'),
    '--app-data-root', path.join(root, 'setup-data'),
    '--events-log', log,
  ]);
  try {
    await waitFor(() => existsSync(log) && /"type"\s*:\s*"done"/i.test(readFileSync(log, 'utf8')), 'Lite installation', 460);
    return path.join(installDir, '知远.exe');
  } catch (error) {
    console.error(existsSync(log) ? readFileSync(log, 'utf8').slice(-18_000) : setup.output());
    throw error;
  } finally {
    await stop(setup.child);
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function runtime(cdp, expression) {
  return cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
}

async function snapshotProcesses(executable, pid) {
  const script = "Get-CimInstance Win32_Process -Filter 'ParentProcessId = " + pid + "' | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";
  const tasks = await Promise.allSettled([
    execute('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 15_000 }),
    execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/ci/windows-shell-native.ps1', '-Action', 'app', '-AppPath', executable], { timeout: 20_000 }),
  ]);
  return tasks.map(item => item.status === 'fulfilled' ? item.value.stdout.trim() : String(item.reason));
}

const preflight = `(() => {
  const bound = !!window.electron?.desktopPet;
  return { bound, ready: document.readyState, url: location.href };
})()`;
const snapshot = `(() => {
  const canvas = document.querySelector('#desktop-pet');
  if (!canvas) return null;
  let nonEmptyCanvas = false;
  try { nonEmptyCanvas = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0); } catch {}
  return { bound: !!window.desktopPet, visible: !document.hidden, canvas: {...canvas.dataset}, nonEmptyCanvas };
})()`;

async function observe(executable, name, patch) {
  const profile = path.join(root, `profile-${name}`);
  mkdirSync(profile, { recursive: true });
  const port = await freePort();
  const app = launch(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    ...process.env,
    ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: profile,
    ELECTRON_ENABLE_LOGGING: '1',
  });
  const report = { name, patch };
  const open = [];
  const targets = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    return response.json();
  };
  async function connect(target) {
    const session = await Cdp.connect(target.webSocketDebuggerUrl);
    open.push(session);
    await session.send('Runtime.enable');
    await session.send('Log.enable');
    return session;
  }
  try {
    const index = await waitFor(async () => (await targets()).find(target => /\/dist\/index\.html/.test(target.url)), 'main renderer');
    const main = await connect(index);
    await waitFor(async () => (await runtime(main, preflight)).result.value?.bound, 'main preload');
    await waitFor(async () => {
      report.initial = await runtime(main, 'window.electron.desktopPet.getSettings()');
      return report.initial.result.value;
    }, 'settings handler');
    report.operation = await runtime(main, `window.electron.desktopPet.setSettings(${JSON.stringify(patch)})`);
    const pet = await waitFor(async () => (await targets()).find(target => /desktop-pet\.html/.test(target.url)), 'desktop pet renderer', 32);
    const renderer = await connect(pet);
    report.firstFrame = (await runtime(renderer, snapshot)).result.value;
    await delay(9_000);
    report.lateFrame = (await runtime(renderer, snapshot)).result.value;
    report.mainExceptions = main.observations;
    report.petExceptions = renderer.observations;
    report.companion = (await targets()).filter(target => /companion\.html/.test(target.url)).map(target => target.url);
  } catch (error) {
    report.failure = error.stack;
  } finally {
    report.appExitCode = app.child.exitCode;
    if (app.child.pid) report.processesAndWindows = await snapshotProcesses(executable, app.child.pid);
    const logFolder = path.join(profile, 'logs');
    if (existsSync(logFolder)) {
      report.log = readdirSync(logFolder).filter(file => /^main.*\.log$/.test(file)).map(file => readFileSync(path.join(logFolder, file), 'utf8').slice(-70_000));
    }
    for (const session of open) session.close();
    await stop(app.child);
    writeFileSync(path.join(evidence, `${name}-app-output.log`), app.output());
    writeFileSync(path.join(evidence, `${name}.json`), JSON.stringify(report, null, 2));
    const { log, processesAndWindows, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
    console.log(log?.flatMap(file => file.split(/\r?\n/).filter(line => /desktop.pet|windowsurface|uncaught|child process|error occurred/i.test(line))).join('\n') ?? '');
    console.log(processesAndWindows?.[0] ?? '');
  }
}

const executable = mode === '--installed' ? source : await install();
if (!existsSync(executable)) throw Error(`Installed executable missing: ${executable}`);
await observe(executable, 'default', { enabled: true });
await observe(executable, 'without-sensor', { enabled: true, roaming: false, hideInFullscreen: false });
