import type { LlamaCppRuntimeInstallSnapshot } from '../../../../shared/llamacpp';
import { useCallback, useEffect, useRef } from 'react';

import { i18nService } from '../../../services/i18n';
import { isInstallTerminalPhase } from '../utils/progress';
import { isRuntimeInstallActive } from './useRuntimeInstallProgress';

const RuntimeInstallNotificationPhase = {
  Done: 'done',
  Cancelled: 'cancelled',
} as const;

type RuntimeInstallBackgroundNotificationsInput = {
  isVisible: boolean;
  snapshot: LlamaCppRuntimeInstallSnapshot;
  refresh: () => Promise<LlamaCppRuntimeInstallSnapshot>;
};

function showGlobalToast(message: string, isError = false): void {
  window.dispatchEvent(
    new CustomEvent('app:showToast', {
      detail: { message, durationMs: 4_000, isError },
    }),
  );
}

function getRuntimeVersion(snapshot: LlamaCppRuntimeInstallSnapshot): string | undefined {
  return snapshot.progress?.modelName?.trim() || undefined;
}

export function useRuntimeInstallBackgroundNotifications({
  isVisible,
  snapshot,
  refresh,
}: RuntimeInstallBackgroundNotificationsInput) {
  const previousVisibleRef = useRef(isVisible);
  const backgroundTaskRef = useRef(false);

  const notifyBackgroundContinuation = useCallback(async () => {
    const nextSnapshot = await refresh();
    if (!isRuntimeInstallActive(nextSnapshot) || backgroundTaskRef.current) return;

    backgroundTaskRef.current = true;
    const version = getRuntimeVersion(nextSnapshot);
    showGlobalToast(
      version
        ? i18nService
            .t('localInferenceRuntimeBackgroundInstallContinues')
            .replace('{version}', version)
        : i18nService.t('localInferenceRuntimeBackgroundInstallContinuesGeneric'),
    );
  }, [refresh]);

  useEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = isVisible;
    if (wasVisible && !isVisible) void notifyBackgroundContinuation();
  }, [isVisible, notifyBackgroundContinuation]);

  useEffect(() => {
    const progress = snapshot.progress;
    if (!progress || snapshot.active || !isInstallTerminalPhase(progress.phase)) return;
    if (!backgroundTaskRef.current) return;

    const version = getRuntimeVersion(snapshot);
    backgroundTaskRef.current = false;
    if (progress.phase === RuntimeInstallNotificationPhase.Done) {
      showGlobalToast(
        version
          ? i18nService
              .t('localInferenceRuntimeBackgroundInstallDone')
              .replace('{version}', version)
          : i18nService.t('localInferenceRuntimeReady'),
      );
      return;
    }
    if (progress.phase === RuntimeInstallNotificationPhase.Cancelled) {
      showGlobalToast(i18nService.t('localInferenceRuntimeInstallCancelled'));
      return;
    }
    showGlobalToast(
      version
        ? i18nService.t('localInferenceRuntimeBackgroundInstallFailed').replace('{version}', version)
        : i18nService.t('localInferenceRuntimeMissing'),
      true,
    );
  }, [snapshot]);

  return { notifyBackgroundContinuation };
}
