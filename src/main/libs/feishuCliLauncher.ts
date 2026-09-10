import fs from 'fs';
import path from 'path';

import { getFeishuCliBinDirectory, getFeishuCliRoot } from './feishuConnectorPaths';

export function getFeishuCliLauncherPath(userDataPath: string): string {
  const launcherName = process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli';
  return path.join(getFeishuCliBinDirectory(userDataPath), launcherName);
}

export function getFeishuNativeCliPath(cliRoot: string): string {
  const binaryName = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
  return path.join(cliRoot, 'node_modules', '@larksuite', 'cli', 'bin', binaryName);
}

export async function writeFeishuCliLauncher(userDataPath: string): Promise<void> {
  const cliRoot = getFeishuCliRoot(userDataPath);
  const launcherPath = getFeishuCliLauncherPath(userDataPath);
  await fs.promises.access(getFeishuNativeCliPath(cliRoot));
  await fs.promises.mkdir(path.dirname(launcherPath), { recursive: true });
  if (process.platform === 'win32') {
    await fs.promises.writeFile(
      launcherPath,
      '@echo off\r\n"%~dp0..\\node_modules\\@larksuite\\cli\\bin\\lark-cli.exe" %*\r\n',
      'utf8',
    );
    return;
  }
  await fs.promises.writeFile(
    launcherPath,
    '#!/bin/sh\nexec "$(dirname "$0")/../node_modules/@larksuite/cli/bin/lark-cli" "$@"\n',
    'utf8',
  );
  await fs.promises.chmod(launcherPath, 0o755);
}
