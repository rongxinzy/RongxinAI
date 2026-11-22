/** Project / workspace path resolution and validation helpers. */
import { mkdir, stat } from 'node:fs/promises';
import path from 'path';

import { app } from 'electron';

import { coworkImageRoot } from '../coworkImageAttachments';
import { getCoworkStore } from './runtimeServices';

export const resolveTaskWorkingDirectory = async (workspaceRoot: string): Promise<string> => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  // Reject bare Windows drive roots (e.g. "D:\") — mkdir on drive roots causes EPERM,
  // and tool runtimes may fail when given a drive root as workspace.
  if (process.platform === 'win32' && /^[a-zA-Z]:\\?$/.test(resolvedWorkspaceRoot)) {
    throw new Error(
      `Cannot use a drive root as the working directory (${resolvedWorkspaceRoot}). Please select a subfolder instead, for example: ${resolvedWorkspaceRoot}Projects`,
    );
  }
  const info = await stat(resolvedWorkspaceRoot).catch((error: NodeJS.ErrnoException): null => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) {
    await mkdir(resolvedWorkspaceRoot, { recursive: true });
  } else if (!info.isDirectory()) {
    throw new Error(`Selected workspace is not a directory: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

// Project working-directory helpers
export const getDefaultProjectBaseDir = () =>
  path.join(app.getPath('documents'), 'ZhiYuanAgent', 'Workspaces');
export const getUnmanagedWorkspaceBaseDir = () =>
  path.join(app.getPath('userData'), 'unmanaged-workspaces');
export const getCoworkImageRoot = (): string => coworkImageRoot(app.getPath('userData'));
const isUuidDirectoryName = (directoryName: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(directoryName);
const isLegacyUnmanagedWorkspacePath = (candidatePath: string): boolean => {
  const relativePath = path.relative(getDefaultProjectBaseDir(), candidatePath);
  return !relativePath.includes(path.sep) && isUuidDirectoryName(relativePath);
};
const isUnmanagedWorkspacePath = (candidatePath: string): boolean => {
  const relativePath = path.relative(getUnmanagedWorkspaceBaseDir(), candidatePath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
};
export const isInternalWorkspacePath = (candidatePath: string): boolean =>
  isLegacyUnmanagedWorkspacePath(candidatePath) || isUnmanagedWorkspacePath(candidatePath);

export const resolveSessionWorkingDirectory = (options: { cwd?: string }): string => {
  const explicitWorkingDirectory = options.cwd?.trim();
  if (explicitWorkingDirectory) return explicitWorkingDirectory;
  return getCoworkStore().getConfig().workingDirectory.trim();
};
