import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ root: '', spawn: vi.fn(), quit: vi.fn(), exit: vi.fn() }));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.root, quit: mocks.quit, exit: mocks.exit },
}));

import { readInstallResult } from './appUpdateInstallReceipt';
import { installWindowsNsis } from './appUpdateInstaller';

afterEach(async () => {
  vi.clearAllMocks();
  if (mocks.root) await fs.promises.rm(mocks.root, { recursive: true, force: true });
});

test('confirms the Windows helper started before quitting and records the target version', async () => {
  mocks.root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'update-handoff-'));
  const installer = path.join(mocks.root, 'ZhiYuan-Setup.exe');
  await fs.promises.writeFile(installer, 'installer');
  mocks.spawn.mockImplementation((_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { pid: 1234, unref: vi.fn() });
    queueMicrotask(() => {
      fs.writeFileSync(args[0].replace(/\.vbs$/, '.started'), 'started');
      child.emit('spawn');
    });
    return child;
  });

  await installWindowsNsis(installer, '2026.7.2');

  expect(mocks.quit).toHaveBeenCalledOnce();
  expect(mocks.spawn).toHaveBeenCalledWith('wscript.exe', [expect.stringMatching(/\.vbs$/)], {
    detached: true,
    stdio: 'ignore',
  });
  expect(readInstallResult('2026.7.1')).toMatchObject({
    outcome: 'pending',
    targetVersion: '2026.7.2',
  });
  const scriptPath = path.join(
    mocks.root,
    fs.readdirSync(mocks.root).find(name => name.endsWith('.ps1'))!,
  );
  const script = await fs.promises.readFile(scriptPath, 'utf8');
  expect(script).toContain('Start-Process -FilePath $installerPath -Wait -PassThru');
  expect(script).toContain('Write-Receipt "failed"');
  expect(script).not.toContain("-ArgumentList '/S'");
});

test('keeps the app open and records a failed handoff when the helper cannot launch', async () => {
  mocks.root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'update-handoff-'));
  const installer = path.join(mocks.root, 'ZhiYuan-Setup.exe');
  await fs.promises.writeFile(installer, 'installer');
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: undefined, unref: vi.fn() });
    queueMicrotask(() => child.emit('error', new Error('wscript unavailable')));
    return child;
  });

  await expect(installWindowsNsis(installer, '2026.7.2')).rejects.toThrow('wscript unavailable');
  expect(mocks.quit).not.toHaveBeenCalled();
  expect(readInstallResult('2026.7.1')?.outcome).toBe('failed');
});
