import { useEffect } from 'react';
import type { CompanionReceipt, CompanionWindowApi } from '../../shared/companion/types';
import { CompanionRequestState } from '../../shared/companion/constants';

export function useCompanionAnswer({
  api,
  pending,
  visible,
  reload,
  onError,
}: {
  api?: CompanionWindowApi;
  pending: CompanionReceipt | null | undefined;
  visible: boolean;
  reload: () => Promise<void>;
  onError: (key: string) => void;
}) {
  const petId = pending?.petId;
  const requestId = pending?.requestId;
  const submissionId = pending?.submissionId;
  useEffect(() => {
    if (!petId || !requestId || submissionId === undefined || !visible || !api) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const answer = await api.answer({ petId, requestId, submissionId });
        if (!active) return;
        if (answer.state !== CompanionRequestState.Accepted) {
          await reload();
          if (active && answer.state === CompanionRequestState.Unanswered)
            onError('companionFailed');
          return;
        }
      } catch {
        if (active) onError('companionLoadFailed');
        return;
      }
      if (active) timer = setTimeout(check, 500);
    };
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // Receipt fields, rather than bootstrap object identity, define a polling lifetime.
  }, [api, petId, requestId, submissionId, visible, reload, onError]);
}
