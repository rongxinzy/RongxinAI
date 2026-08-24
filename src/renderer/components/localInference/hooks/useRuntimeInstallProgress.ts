import type { LlamaCppInstallProgress, LlamaCppRuntimeInstallSnapshot } from '../../../../shared/llamacpp';
import { LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID } from '../../../../shared/llamacpp';
import { useCallback, useEffect, useState } from 'react';

import { isInstallTerminalPhase } from '../utils/progress';

const idleRuntimeInstallSnapshot: LlamaCppRuntimeInstallSnapshot = { active: false };

export function isRuntimeInstallActive(snapshot: LlamaCppRuntimeInstallSnapshot): boolean {
  return Boolean(
    snapshot.active &&
      (!snapshot.progress || !isInstallTerminalPhase(snapshot.progress.phase)),
  );
}

export function useRuntimeInstallProgress() {
  const [snapshot, setSnapshot] = useState<LlamaCppRuntimeInstallSnapshot>(
    idleRuntimeInstallSnapshot,
  );

  const refresh = useCallback(async (): Promise<LlamaCppRuntimeInstallSnapshot> => {
    const nextSnapshot = await window.electron.llamacpp.getRuntimeInstallSnapshot();
    setSnapshot(nextSnapshot);
    return nextSnapshot;
  }, []);

  useEffect(() => {
    // Progress belongs to the main process so a remounted dialog can rehydrate it.
    const unsubscribe = window.electron.llamacpp.onInstallProgress(
      (progress: LlamaCppInstallProgress) => {
        if (progress.modelId !== LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID) return;
        setSnapshot({
          active: !isInstallTerminalPhase(progress.phase),
          progress,
        });
      },
    );
    void refresh().catch(() => undefined);
    return unsubscribe;
  }, [refresh]);

  return { snapshot, refresh };
}
