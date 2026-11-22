import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  closeBrowser,
  isBrowserRunning,
  isOwnedCdpReachable,
  launchBrowser,
} from '../SKILLs/web-search/server/playwright/browser';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn }));

class BrowserProcess extends EventEmitter {
  readonly stdout = null;
  readonly stderr = null;
  pid: number | undefined = 123;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly kill = vi.fn(() => {
    this.killed = true;
    return true;
  });

  exit(signal: NodeJS.Signals) {
    this.signalCode = signal;
    this.emit('exit', null, signal);
  }
}

const config = {
  chromePath: 'fake-chrome',
  headless: true,
  fallbackToHeadful: false,
};
const cdpPort = 19_523;
const browserPath = '/devtools/browser/49334186-a32e-4d21-b821-8965a00f4912';
const cdpWebSocketUrl = `ws://127.0.0.1:${cdpPort}${browserPath}`;
let profileRoot: string;

function instance(process: BrowserProcess) {
  return {
    process: process as unknown as ChildProcess,
    pid: process.pid!,
    cdpPort,
    cdpWebSocketUrl,
    headless: true,
    startTime: 0,
    removeProfile: vi.fn(async () => {}),
  };
}

function mockLaunch(
  process: BrowserProcess,
  {
    announceCdp = false,
    error,
  }: {
    announceCdp?: boolean;
    error?: Error;
  } = {},
) {
  return new Promise<string>(resolve => {
    spawn.mockImplementation((_executable: string, args: string[]) => {
      const profile = args
        .find(arg => arg.startsWith('--user-data-dir='))!
        .slice('--user-data-dir='.length);
      if (announceCdp)
        writeFileSync(join(profile, 'DevToolsActivePort'), `${cdpPort}\n${browserPath}`);
      queueMicrotask(() => {
        if (error) process.emit('error', error);
        else process.emit('spawn');
        resolve(profile);
      });
      return process;
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  spawn.mockReset();
  profileRoot = mkdtempSync(join(tmpdir(), 'web-search-browser-test-'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(profileRoot, { recursive: true, force: true });
});

test('escalates a signal accepted by a still-running browser and waits for exit', async () => {
  const process = new BrowserProcess();
  const browser = instance(process);
  const closed = vi.fn();
  const closing = closeBrowser(browser).then(closed);
  expect(process.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
  expect(isBrowserRunning(browser)).toBe(true);

  await vi.advanceTimersByTimeAsync(5_000);
  expect(process.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  expect(closed).not.toHaveBeenCalled();
  process.exit('SIGKILL');
  await closing;
  expect(isBrowserRunning(browser)).toBe(false);
  expect(browser.removeProfile).toHaveBeenCalledOnce();
});

test('waits for child cleanup before reporting a CDP startup timeout', async () => {
  const process = new BrowserProcess();
  const spawned = mockLaunch(process);
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(20_000);
  const finished = vi.fn();
  const launch = launchBrowser({ ...config, userDataDir: profileRoot }).catch(error => {
    finished();
    return error;
  });
  const profile = await spawned;
  await vi.advanceTimersByTimeAsync(0);
  expect(process.kill).toHaveBeenCalledTimes(1);
  expect(finished).not.toHaveBeenCalled();
  expect(existsSync(profile)).toBe(true);

  await vi.advanceTimersByTimeAsync(5_000);
  expect(process.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  process.exit('SIGKILL');
  expect(await launch).toMatchObject({ message: /Chrome CDP did not become ready/ });
  expect(existsSync(profile)).toBe(false);
});

test('a naturally exited browser is no longer running and requires no signal', async () => {
  const process = new BrowserProcess();
  process.exitCode = 0;
  expect(isBrowserRunning(instance(process))).toBe(false);
  await closeBrowser(instance(process));
  expect(process.kill).not.toHaveBeenCalled();
});

test.each(['request', 'retry delay'])(
  'aborts CDP startup during a %s and closes its child',
  async stage => {
    const process = new BrowserProcess();
    const spawned = mockLaunch(process, { announceCdp: true });
    const controller = new AbortController();
    const reason = new Error('Bridge is shutting down');
    const { promise: requested, resolve: markRequested } = Promise.withResolvers<void>();
    const request = vi.fn((_url: string, { signal }: { signal: AbortSignal }) => {
      markRequested();
      if (stage === 'retry delay') return Promise.reject(new Error('CDP not ready'));
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', request);

    const launch = launchBrowser({ ...config, userDataDir: profileRoot }, controller.signal).catch(
      error => error,
    );
    const profile = await spawned;
    await requested;
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledOnce();
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(process.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    process.exit('SIGTERM');
    expect(await launch).toBe(reason);
    expect(existsSync(profile)).toBe(false);
    expect(request).toHaveBeenCalledOnce();
  },
);

test('reports a failed spawn without attempting to signal a missing child', async () => {
  const process = new BrowserProcess();
  process.pid = undefined;
  const error = new Error('missing executable');
  const spawned = mockLaunch(process, { error });

  const launch = launchBrowser({ ...config, userDataDir: profileRoot }).catch(failure => failure);
  const profile = await spawned;
  expect(await launch).toBe(error);
  expect(process.kill).not.toHaveBeenCalled();
  expect(existsSync(profile)).toBe(false);
});

test('reports a child that never exits within the forced shutdown budget', async () => {
  const process = new BrowserProcess();
  const browser = instance(process);
  const closed = closeBrowser(browser).catch(error => error);
  await vi.advanceTimersByTimeAsync(7_000);
  expect(process.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  expect(await closed).toMatchObject({ message: /did not exit after SIGKILL/ });
  expect(process.listenerCount('exit')).toBe(0);
  expect(process.listenerCount('error')).toBe(0);
  expect(browser.removeProfile).not.toHaveBeenCalled();
});

test('checks the managed Chrome port and browser identity and removes only its profile', async () => {
  const process = new BrowserProcess();
  const spawned = mockLaunch(process, { announceCdp: true });
  const otherBrowserPath = '/devtools/browser/00000000-0000-4000-a000-000000000001';
  const request = vi.fn(async (url: string) =>
    Response.json({
      webSocketDebuggerUrl:
        url === `http://127.0.0.1:${cdpPort}/json/version`
          ? cdpWebSocketUrl
          : `ws://127.0.0.1:9222${otherBrowserPath}`,
    }),
  );
  vi.stubGlobal('fetch', request);
  const callerFile = join(profileRoot, 'keep.txt');
  writeFileSync(callerFile, 'caller owned');
  const launch = launchBrowser({ ...config, userDataDir: profileRoot });
  const profile = await spawned;
  const browser = await launch;
  expect(browser.cdpPort).toBe(cdpPort);
  expect(browser.cdpWebSocketUrl).toBe(cdpWebSocketUrl);
  expect(profile).not.toBe(profileRoot);
  expect(spawn.mock.calls[0][1]).toContain('--remote-debugging-port=0');
  request.mockResolvedValueOnce(
    Response.json({
      webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}${otherBrowserPath}`,
    }),
  );
  expect(await isOwnedCdpReachable(browser)).toBe(false);

  const closing = closeBrowser(browser);
  process.exit('SIGTERM');
  await closing;
  expect(existsSync(profile)).toBe(false);
  expect(existsSync(callerFile)).toBe(true);
});
