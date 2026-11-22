import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

import { APP_USER_MODEL_ID } from '../appConstants';
import { prepareWindowsTaskbarIdentity } from './windowBranding';

const electron = vi.hoisted(() => ({
  app: { isPackaged: false, getPath: vi.fn() },
  shell: { readShortcutLink: vi.fn(), writeShortcutLink: vi.fn() },
}));
vi.mock('electron', () => electron);
vi.mock('./appEnv', async () => {
  const { APP_USER_MODEL_ID } =
    await vi.importActual<typeof import('../appConstants')>('../appConstants');
  return {
    runtimeAppName: 'ZhiYuan (Dev)',
    WINDOWS_TASKBAR_APP_USER_MODEL_ID: `${APP_USER_MODEL_ID}.dev`,
  };
});

const originalPlatform = process.platform;
let directory: string | undefined;
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.restoreAllMocks();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test('Windows dev startup cleans stale owned Electron links and preserves installed and foreign shortcuts', async () => {
  directory = fs.mkdtempSync(path.join(tmpdir(), 'zhiyuan-start-menu-'));
  const programs = path.join(directory, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const nested = path.join(programs, 'Tools');
  fs.mkdirSync(nested, { recursive: true });
  const stale = path.join(nested, 'Electron.lnk');
  const installed = path.join(programs, '知远智能体.lnk');
  const foreign = path.join(programs, '知远资料.lnk');
  for (const file of [stale, installed, foreign]) fs.writeFileSync(file, 'original');
  electron.app.getPath.mockReturnValue(directory);
  electron.shell.readShortcutLink.mockImplementation((file: string) => ({
    appUserModelId: file === foreign ? 'com.example.other' : APP_USER_MODEL_ID,
    target: file === installed ? 'C:\\Programs\\ZhiYuan\\知远.exe' : 'C:\\old\\electron.exe',
  }));
  electron.shell.writeShortcutLink.mockImplementation((file: string) => {
    fs.writeFileSync(file, 'dev shortcut');
    return true;
  });
  const access = fs.promises.access;
  vi.spyOn(fs.promises, 'access').mockImplementation((file, mode) =>
    typeof file === 'string' && file.endsWith(`${path.sep}icon.ico`)
      ? Promise.resolve()
      : access(file, mode),
  );
  const scan = vi.spyOn(fs.promises, 'opendir');
  Object.defineProperty(process, 'platform', { value: 'win32' });

  const preparing = prepareWindowsTaskbarIdentity();
  expect(electron.shell.readShortcutLink).not.toHaveBeenCalled();
  await preparing;

  expect(scan.mock.calls.map(([root]) => root)).toEqual([programs, nested]);
  expect(fs.existsSync(stale)).toBe(false);
  expect(fs.existsSync(installed)).toBe(true);
  expect(fs.readFileSync(foreign, 'utf8')).toBe('original');
  expect(electron.shell.writeShortcutLink).toHaveBeenCalledWith(
    path.join(programs, 'ZhiYuan-Dev.lnk'),
    'create',
    expect.objectContaining({ appUserModelId: `${APP_USER_MODEL_ID}.dev` }),
  );
});
