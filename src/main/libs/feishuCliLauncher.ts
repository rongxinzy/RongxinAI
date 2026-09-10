import fs from 'fs';
import path from 'path';

import { getFeishuCliRoot } from './feishuConnectorPaths';

export function getFeishuCliLauncherPath(userDataPath: string): string {
  return getFeishuNativeCliPath(getFeishuCliRoot(userDataPath));
}

export function getFeishuNativeCliPath(cliRoot: string): string {
  const binaryName = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
  return path.join(cliRoot, 'bin', binaryName);
}

export async function writeFeishuCliLauncher(userDataPath: string): Promise<void> {
  const cliRoot = getFeishuCliRoot(userDataPath);
  const launcherPath = getFeishuCliLauncherPath(userDataPath);
  await fs.promises.access(getFeishuNativeCliPath(cliRoot));
  await fs.promises.chmod(launcherPath, 0o755);
}
