import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, expect, test } from 'vitest';

import { getFeishuCliRoot } from './feishuConnectorPaths';
import {
  getFeishuCliLauncherPath,
  getFeishuNativeCliPath,
  writeFeishuCliLauncher,
} from './feishuCliLauncher';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

test('uses the app-owned native binary instead of an npm launcher', async () => {
  const userDataPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'zhiyuan-feishu-launcher-'),
  );
  temporaryDirectories.push(userDataPath);
  const nativeCliPath = getFeishuNativeCliPath(getFeishuCliRoot(userDataPath));
  await fs.promises.mkdir(path.dirname(nativeCliPath), { recursive: true });
  await fs.promises.writeFile(nativeCliPath, 'native-cli', 'utf8');

  await writeFeishuCliLauncher(userDataPath);

  const launcherPath = getFeishuCliLauncherPath(userDataPath);
  expect(launcherPath).toBe(nativeCliPath);
  expect(launcherPath).not.toContain('node_modules');
  expect(launcherPath).not.toContain('.bin');
});
