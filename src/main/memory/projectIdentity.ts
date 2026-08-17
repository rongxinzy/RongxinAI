import {
  normalizeWorkspacePath,
  workspaceIdForPath,
  workspaceNameForPath,
} from '../workspaceUtils';

export interface ProjectIdentity {
  id: string;
  displayName: string;
  root: string;
}

export function resolveProjectIdentity(workingDirectory: string): ProjectIdentity {
  const root = normalizeWorkspacePath(workingDirectory);
  return {
    id: workspaceIdForPath(root),
    displayName: workspaceNameForPath(root),
    root,
  };
}
