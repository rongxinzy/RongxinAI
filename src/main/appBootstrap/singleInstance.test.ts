import { hostname } from 'node:os';
import { posix as path } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { handleSecondInstanceExit } from './singleInstance';

const mocked = vi.hoisted(() => ({
  readFile: vi.fn(),
  readlink: vi.fn(),
  stat: vi.fn(),
  showMessageBox: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocked.readFile,
  readlink: mocked.readlink,
  stat: mocked.stat,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/test-profile',
    getVersion: () => '2.0.0',
    whenReady: async () => {},
    relaunch: mocked.relaunch,
    exit: mocked.exit,
  },
  dialog: { showMessageBox: mocked.showMessageBox },
}));

const originalPlatform = process.platform;
const pid = process.pid + 100;
const lockPath = path.join('/test-profile', 'SingletonLock');
const oldImage = '/images/知远-1.0.0.AppImage';
const appDir = '/tmp/.mount_zhiyuan1';
let lock: string;
let startTime: string;
let executable: string;
let environment: string;
let commandLine: string;
let state: string;

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.stubEnv('APPIMAGE', '/images/知远-2.0.0.AppImage');
  lock = `${hostname()}-${pid}`;
  startTime = '100';
  executable = `${appDir}/知远`;
  environment = `APPIMAGE=${oldImage}\0APPDIR=${appDir}\0`;
  commandLine = `${executable}\0`;
  state = 'S';
  mocked.readlink.mockImplementation(async (path: string) => {
    if (path === lockPath) return lock;
    if (path === `/proc/${pid}/exe`) return executable;
    throw Object.assign(new Error('Unknown path'), { code: 'ENOENT' });
  });
  mocked.readFile.mockImplementation(async (path: string) => {
    if (path === `/proc/${pid}/environ`) return environment;
    if (path === `/proc/${pid}/cmdline`) return commandLine;
    if (path === `/proc/${pid}/stat`) {
      return `${pid} (app name)) ${state} ${'0 '.repeat(18)}${startTime}\n`;
    }
    throw Object.assign(new Error('Unknown path'), { code: 'ENOENT' });
  });
  mocked.stat.mockResolvedValue({ uid: process.geteuid?.() });
  mocked.showMessageBox.mockResolvedValue({ response: 0 });
  vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 'SIGTERM') state = 'Z';
    return true;
  });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function runSecondInstance() {
  handleSecondInstanceExit();
  await vi.waitFor(() => expect(mocked.exit).toHaveBeenCalledWith(0));
}

test('takes over only the confirmed old AppImage holding this profile lock', async () => {
  await runSecondInstance();

  expect(mocked.showMessageBox).toHaveBeenCalledOnce();
  expect(process.kill).toHaveBeenCalledExactlyOnceWith(pid, 'SIGTERM');
  expect(mocked.relaunch).toHaveBeenCalledOnce();
});

test.each([
  '/opt/知远智能体 (ZhiYuan Agent)/知远',
  '/opt/知远/知远 (deleted)',
  '/opt/ZhiYuanAgent/ZhiYuanAgent',
])('supports the deb executable %s during an upgrade', async installedExecutable => {
  executable = installedExecutable;
  environment = '';

  await runSecondInstance();

  expect(mocked.showMessageBox).toHaveBeenCalledOnce();
  expect(process.kill).toHaveBeenCalledExactlyOnceWith(pid, 'SIGTERM');
  expect(mocked.relaunch).toHaveBeenCalledOnce();
});

test.each(['lock', 'process start time', 'executable'])(
  'skips takeover when the %s changes while confirming',
  async change => {
    mocked.showMessageBox.mockImplementationOnce(async () => {
      if (change === 'lock') lock = `${hostname()}-${pid + 1}`;
      if (change === 'process start time') startTime = '200';
      if (change === 'executable') executable = '/usr/bin/node';
      return { response: 0 };
    });

    await runSecondInstance();

    expect(mocked.showMessageBox).toHaveBeenCalledOnce();
    expect(process.kill).not.toHaveBeenCalled();
    expect(mocked.relaunch).not.toHaveBeenCalled();
  },
);

test.each(['remote lock', 'same image', 'unrelated executable', 'renderer', 'different user'])(
  'leaves the existing profile alone for a %s',
  async reason => {
    if (reason === 'remote lock') lock = `remote-host-${pid}`;
    if (reason === 'same image')
      environment = `APPIMAGE=${process.env.APPIMAGE}\0APPDIR=${appDir}\0`;
    if (reason === 'unrelated executable') executable = '/usr/bin/node';
    if (reason === 'renderer') commandLine += '--type=renderer\0';
    if (reason === 'different user')
      mocked.stat.mockResolvedValue({ uid: (process.geteuid?.() ?? 0) + 1 });

    await runSecondInstance();

    expect(mocked.showMessageBox).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
    expect(mocked.relaunch).not.toHaveBeenCalled();
  },
);

test('cancellation exits without signaling the identified owner', async () => {
  mocked.showMessageBox.mockResolvedValueOnce({ response: 1 });

  await runSecondInstance();

  expect(mocked.showMessageBox).toHaveBeenCalledOnce();
  expect(process.kill).not.toHaveBeenCalled();
  expect(mocked.relaunch).not.toHaveBeenCalled();
});

test('waits for the original owner and never signals a PID reused after shutdown', async () => {
  vi.mocked(process.kill).mockImplementationOnce(() => {
    startTime = '201';
    return true;
  });

  await runSecondInstance();

  expect(process.kill).toHaveBeenCalledExactlyOnceWith(pid, 'SIGTERM');
  expect(mocked.relaunch).toHaveBeenCalledOnce();
});
