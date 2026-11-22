/**
 * Browser Launcher - Manages Chrome browser lifecycle
 */

import { spawn, type ChildProcess } from 'child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, accessSync, constants } from 'fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { BrowserConfig } from '../config';

export interface BrowserInstance {
  process: ChildProcess;
  pid: number;
  cdpPort: number;
  cdpWebSocketUrl: string;
  headless: boolean;
  startTime: number;
  removeProfile(): Promise<void>;
}

/**
 * Detect Chromium-based browser executable path across platforms
 */
export function getChromePath(): string {
  const platform = process.platform;
  const paths: string[] = [];

  if (platform === 'darwin') {
    // macOS
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    );
  } else if (platform === 'win32') {
    // Windows
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    paths.push(
      join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    );
  } else {
    // Linux
    paths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/snap/bin/chromium',
    );
  }

  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    'No Chromium-based browser found (Chrome/Edge/Chromium). Please install one and retry.',
  );
}

function isDirectoryWritable(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveRuntimeChromeFlags(configFlags: string[] = []): string[] {
  const runtimeFlags = [...configFlags];

  if (process.platform === 'linux') {
    if (!isDirectoryWritable('/dev/shm')) {
      console.warn('[Browser] /dev/shm is unavailable, enabling --disable-dev-shm-usage');
      runtimeFlags.push('--disable-dev-shm-usage');
    }

    if (!isDirectoryWritable('/dev/mqueue')) {
      console.warn('[Browser] /dev/mqueue is unavailable in this environment');
    }

    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      console.warn('[Browser] Running as root, enabling --no-sandbox');
      runtimeFlags.push('--no-sandbox');
    }
  }

  return Array.from(new Set(runtimeFlags));
}

function resolveHeadlessMode(configHeadless: boolean): boolean {
  if (configHeadless) {
    return true;
  }

  if (process.platform !== 'linux') {
    return false;
  }

  const hasDisplay = Boolean(
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.MIR_SOCKET,
  );
  if (hasDisplay) {
    return false;
  }

  console.warn('[Browser] No Linux display detected, forcing headless mode');
  return true;
}

type OwnedCdp = Pick<BrowserInstance, 'process' | 'cdpPort' | 'cdpWebSocketUrl'>;

export async function isOwnedCdpReachable(browser: OwnedCdp, signal?: AbortSignal): Promise<boolean> {
  if (!isProcessRunning(browser.process)) return false;
  const timeout = AbortSignal.timeout(1500);
  try {
    const response = await fetch(`http://127.0.0.1:${browser.cdpPort}/json/version`, {
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) return false;
    const version = (await response.json()) as { webSocketDebuggerUrl?: string } | null;
    return (
      version?.webSocketDebuggerUrl === browser.cdpWebSocketUrl &&
      isProcessRunning(browser.process)
    );
  } catch {
    return false;
  }
}

async function waitForCDP(
  profile: string,
  browserProcess: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<OwnedCdp> {
  const startTime = Date.now();
  const activePortFile = join(profile, 'DevToolsActivePort');

  while (Date.now() - startTime < timeoutMs) {
    signal?.throwIfAborted();
    if (!isProcessRunning(browserProcess)) {
      const exitCode = browserProcess.exitCode ?? 'null';
      const exitSignal = browserProcess.signalCode ?? 'none';
      throw new Error(
        `Chrome process exited before CDP was ready (exitCode=${exitCode}, signal=${exitSignal})`,
      );
    }

    const activePort = await readFile(activePortFile, { encoding: 'utf8', signal }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      },
    );
    const match = /^(\d{1,5})\r?\n(\/devtools\/browser\/[a-f\d-]+)\s*$/i.exec(activePort);
    if (match) {
      const cdpPort = Number(match[1]);
      if (cdpPort < 1 || cdpPort > 65_535) throw new Error('Invalid Chrome CDP port');
      const browser = {
        process: browserProcess,
        cdpPort,
        cdpWebSocketUrl: `ws://127.0.0.1:${cdpPort}${match[2]}`,
      };
      const ready = await isOwnedCdpReachable(browser, signal);
      signal?.throwIfAborted();
      if (ready) return browser;
    }
    await delay(100, undefined, { signal });
  }

  throw new Error(`Chrome CDP did not become ready within ${timeoutMs}ms`);
}

/**
 * Launch Chrome browser with CDP enabled
 */
export async function launchBrowser(
  config: BrowserConfig,
  signal?: AbortSignal,
): Promise<BrowserInstance> {
  signal?.throwIfAborted();
  const chromePath = config.chromePath || getChromePath();
  const runtimeChromeFlags = resolveRuntimeChromeFlags(config.chromeFlags || []);
  const runtimeHeadless = resolveHeadlessMode(config.headless);
  const profileRoot = config.userDataDir ?? tmpdir();
  await mkdir(profileRoot, { recursive: true });
  signal?.throwIfAborted();
  const profile = await mkdtemp(join(profileRoot, 'zhiyuan-web-search-'));
  let profileCleanup: Promise<void> | undefined;
  const removeProfile = () =>
    (profileCleanup ??= rm(profile, { recursive: true, force: true, maxRetries: 3 }));

  const args = [
    ...runtimeChromeFlags,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
  ];

  if (runtimeHeadless) {
    args.push('--headless=new');
  }

  console.log(`[Browser] Launching Chrome at: ${chromePath}`);
  console.log(`[Browser] User data dir: ${profile}`);
  console.log(`[Browser] Headless: ${runtimeHeadless}`);
  console.log(`[Browser] Flags: ${runtimeChromeFlags.join(' ') || '(none)'}`);

  const recentStderr: string[] = [];
  let browserProcess: ChildProcess | undefined;
  try {
    signal?.throwIfAborted();
    browserProcess = spawn(chromePath, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    browserProcess.once('close', () => {
      void removeProfile().catch(error => {
        console.warn('[Browser] Failed to remove the Chrome profile:', error);
      });
    });
    browserProcess.stdout?.on('data', data => {
      console.log(`[Browser stdout] ${data.toString().trim()}`);
    });
    browserProcess.stderr?.on('data', data => {
      const message = data.toString().trim();
      console.log(`[Browser stderr] ${message}`);
      if (!message) {
        return;
      }

      for (const line of message
        .split('\n')
        .map((item: string) => item.trim())
        .filter(Boolean)) {
        recentStderr.push(line);
      }
      while (recentStderr.length > 12) {
        recentStderr.shift();
      }
    });

    await once(browserProcess, 'spawn');
    const pid = browserProcess.pid;
    if (!pid) throw new Error('Failed to start Chrome process');
    console.log(`[Browser] Chrome started with PID: ${pid}`);
    const cdp = await waitForCDP(profile, browserProcess, 20_000, signal);
    console.log(`[Browser] CDP ready on port ${cdp.cdpPort}`);
    return {
      ...cdp,
      pid,
      headless: runtimeHeadless,
      startTime: Date.now(),
      removeProfile,
    };
  } catch (error) {
    const startupError = signal?.aborted ? signal.reason : error;
    try {
      if (browserProcess) await stopBrowserProcess(browserProcess);
      await removeProfile();
    } catch (cleanupError) {
      console.warn('[Browser] Failed to clean up Chrome after startup failed:', cleanupError);
    }
    if (recentStderr.length > 0) {
      const baseMessage = startupError instanceof Error ? startupError.message : String(startupError);
      const tail = recentStderr.slice(-5).join(' | ');
      throw new Error(`${baseMessage}. Recent browser stderr: ${tail}`);
    }
    throw startupError;
  }
}

function isProcessRunning(browserProcess: ChildProcess): boolean {
  return (
    Boolean(browserProcess.pid) &&
    browserProcess.exitCode === null &&
    browserProcess.signalCode === null
  );
}

function signalAndWaitForExit(
  browserProcess: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL',
  timeoutMs: number,
): Promise<boolean> {
  if (!isProcessRunning(browserProcess)) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      browserProcess.off('exit', onExit);
      browserProcess.off('error', onError);
    };
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve(!isProcessRunning(browserProcess));
    }, timeoutMs);
    browserProcess.once('exit', onExit);
    browserProcess.once('error', onError);
    try {
      browserProcess.kill(signal);
    } catch (error) {
      onError(error);
    }
  });
}

async function stopBrowserProcess(browserProcess: ChildProcess): Promise<void> {
  if (!isProcessRunning(browserProcess)) return;
  const pid = browserProcess.pid;
  console.log(`[Browser] Closing browser (PID: ${pid})`);
  // Node sets ChildProcess.killed when it sends a signal.
  if (!(await signalAndWaitForExit(browserProcess, 'SIGTERM', 5000))) {
    console.log(`[Browser] Force killing browser (PID: ${pid})`);
    if (!(await signalAndWaitForExit(browserProcess, 'SIGKILL', 2000))) {
      throw new Error(`Chrome did not exit after SIGKILL (PID: ${pid})`);
    }
  }
  console.log('[Browser] Browser closed');
}

export async function closeBrowser(instance: BrowserInstance): Promise<void> {
  await stopBrowserProcess(instance.process);
  await instance.removeProfile();
}

/**
 * Check if browser is running
 */
export function isBrowserRunning(instance: BrowserInstance | null): boolean {
  return instance !== null && isProcessRunning(instance.process);
}
