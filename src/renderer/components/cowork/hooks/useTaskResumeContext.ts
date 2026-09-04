import { useCallback, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'sonner';

import type { CoworkSessionInterruption } from '../../../../shared/cowork/interruption';
import type { WorkbenchTaskResumeInput } from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { normalizeError } from '../../../services/errorNormalization';
import { updateSessionStatus } from '../../../store/slices/coworkSlice';
import { CoworkSessionStatusValue } from '../../../types/cowork';

export const useTaskResumeContext = (sessionId: string | undefined) => {
  const dispatch = useDispatch();
  const [interruption, setInterruption] = useState<CoworkSessionInterruption | null>(null);
  const [isResuming, setIsResuming] = useState(false);

  useEffect(() => {
    setInterruption(null);
    setIsResuming(false);
  }, [sessionId]);

  const select = useCallback(
    (next: CoworkSessionInterruption) => {
      if (!next.recoverable || next.sessionId !== sessionId || !next.taskId) return;
      setInterruption(next);
    },
    [sessionId],
  );

  const cancel = useCallback(() => setInterruption(null), []);

  const resume = useCallback(
    async (input: Omit<WorkbenchTaskResumeInput, 'taskId'>): Promise<boolean> => {
      if (!interruption?.taskId || isResuming) return false;
      setIsResuming(true);
      try {
        const result = await window.electron.workbenchTask.resume({
          ...input,
          taskId: interruption.taskId,
        });
        if (!result.success) {
          toast.error(normalizeError(result.error || i18nService.t('coworkResumeTaskFailed')));
          return false;
        }
        if (sessionId) {
          dispatch(
            updateSessionStatus({
              sessionId,
              status: CoworkSessionStatusValue.Running,
            }),
          );
        }
        setInterruption(null);
        return true;
      } catch {
        toast.error(i18nService.t('coworkResumeTaskFailed'));
        return false;
      } finally {
        setIsResuming(false);
      }
    },
    [dispatch, interruption?.taskId, isResuming, sessionId],
  );

  return { cancel, interruption, isResuming, resume, select };
};
