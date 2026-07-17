import crypto from 'crypto';
import path from 'path';

const TASK_WORKSPACE_CONTAINER_DIR = '.zhiyuan-tasks';

export const normalizeWorkspacePath = (cwd: string): string => {
  const resolved = path.resolve(cwd.trim());
  const marker = `${path.sep}${TASK_WORKSPACE_CONTAINER_DIR}${path.sep}`;
  const markerIndex = resolved.lastIndexOf(marker);
  if (markerIndex > 0) return resolved.slice(0, markerIndex);
  return resolved;
};

export const workspaceIdForPath = (workspacePath: string): string => {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  const digest = crypto.createHash('sha256').update(normalizedPath).digest('hex').slice(0, 24);
  return `workspace-${digest}`;
};

export const workspaceNameForPath = (workspacePath: string): string => {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  return path.basename(normalizedPath) || normalizedPath;
};
