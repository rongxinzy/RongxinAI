import { useCallback, useEffect, useRef, useState } from 'react';

import { workspaceService } from '../../services/workspace';

interface UseUnmanagedWorkingDirectoryOptions {
  currentWorkspaceId: string | null;
}

export const useUnmanagedWorkingDirectory = ({
  currentWorkspaceId,
}: UseUnmanagedWorkingDirectoryOptions) => {
  const [unmanagedWorkingDirectory, setUnmanagedWorkingDirectory] = useState<string | null>(null);
  const pendingWorkspaceSelectionRef = useRef<string | null>(null);
  const previousWorkspaceIdRef = useRef(currentWorkspaceId);

  useEffect(() => {
    if (previousWorkspaceIdRef.current === currentWorkspaceId) return;

    previousWorkspaceIdRef.current = currentWorkspaceId;
    if (pendingWorkspaceSelectionRef.current === currentWorkspaceId) {
      pendingWorkspaceSelectionRef.current = null;
      return;
    }
    setUnmanagedWorkingDirectory(null);
  }, [currentWorkspaceId]);

  const selectUnmanagedWorkingDirectory = useCallback(
    async (directory: string): Promise<boolean> => {
      const unmanagedWorkspace = await workspaceService.ensureWorkspace(directory, undefined, {
        isHidden: true,
      });
      if (!unmanagedWorkspace) return false;

      pendingWorkspaceSelectionRef.current = unmanagedWorkspace.id;
      setUnmanagedWorkingDirectory(directory);
      await workspaceService.selectWorkspace(unmanagedWorkspace.id, { persistSelection: false });
      return true;
    },
    [],
  );

  const clearUnmanagedWorkingDirectory = useCallback(() => {
    setUnmanagedWorkingDirectory(null);
  }, []);

  return {
    clearUnmanagedWorkingDirectory,
    selectUnmanagedWorkingDirectory,
    unmanagedWorkingDirectory,
  };
};
