import { spawn } from 'child_process';
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

test('creates an app-owned launcher instead of relying on npm .bin', async () => {
  const userDataPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'zhiyuan-feishu-launcher-'),
  );
  temporaryDirectories.push(userDataPath);
  const nativeCliPath = getFeishuNativeCliPath(getFeishuCliRoot(userDataPath));
  await fs.promises.mkdir(path.dirname(nativeCliPath), { recursive: true });
  await fs.promises.writeFile(nativeCliPath, 'native-cli', 'utf8');

  await writeFeishuCliLauncher(userDataPath);

  const launcherPath = getFeishuCliLauncherPath(userDataPath);
  const launcher = await fs.promises.readFile(launcherPath, 'utf8');
  expect(launcher).toContain('node_modules');
  expect(launcher).not.toContain('.bin');
});

test.runIf(process.platform === 'win32')(
  'launches the bundled Windows CLI through the app-owned launcher',
  async () => {
    const userDataPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'zhiyuan-feishu-launcher-runtime-'),
    );
    temporaryDirectories.push(userDataPath);
    const sourceBinaryPath = path.resolve(
      process.cwd(),
      'MCPs',
      'feishu',
      'runtime',
      'win32-x64',
      'node_modules',
      '@larksuite',
      'cli',
      'bin',
      'lark-cli.exe',
    );
    const targetBinaryPath = getFeishuNativeCliPath(getFeishuCliRoot(userDataPath));
    await fs.promises.mkdir(path.dirname(targetBinaryPath), { recursive: true });
    await fs.promises.copyFile(sourceBinaryPath, targetBinaryPath);
    await writeFeishuCliLauncher(userDataPath);

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(getFeishuCliLauncherPath(userDataPath), ['--version'], {
        shell: true,
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
      child.stderr.on('data', chunk => chunks.push(Buffer.from(chunk)));
      child.once('error', reject);
      child.once('close', code => {
        if (code === 0) {
          resolve(Buffer.concat(chunks).toString('utf8'));
          return;
        }
        reject(new Error(`launcher exited with ${code ?? 'unknown'}`));
      });
    });

    expect(output).toContain('lark-cli version 1.0.93');
  },
);
