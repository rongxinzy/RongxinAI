import { useCallback, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import type { CoworkSessionInterruption } from '../../../../shared/cowork/interruption';
import type { WorkbenchTaskResumeInput } from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { normalizeError } from '../../../services/errorNormalization';
import { showAppErrorToast } from '../../../services/toastNotification';
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
      if (!interruption?.taskId || interruption.sessionId !== sessionId || isResuming) return false;
      const target = interruption;
      setIsResuming(true);
      // 2026/09/17 lixiang  开始继续执行时立刻清掉输入框里的暂停任务嵌入
      setInterruption(null);
      // 2026/09/17 lixiang  与普通 continue 一致：发起前先标 Running，才能显示停止按钮
      if (sessionId) {
        dispatch(
          updateSessionStatus({
            sessionId,
            status: CoworkSessionStatusValue.Running,
          }),
        );
      }
      try {
        const result = await window.electron.workbenchTask.resume({
          ...input,
          taskId: target.taskId,
        });
        if (!result.success) {
          toast.error(normalizeError(result.error || i18nService.t('coworkResumeTaskFailed')));
          // 2026/09/17 lixiang  启动失败时恢复嵌入，方便用户重试
          setInterruption(target);
          if (sessionId) {
            dispatch(
              updateSessionStatus({
                sessionId,
                status: CoworkSessionStatusValue.Idle,
              }),
            );
          }
          return false;
        }
        return true;
      } catch {
        toast.error(i18nService.t('coworkResumeTaskFailed'));
        setInterruption(target);
        if (sessionId) {
          dispatch(
            updateSessionStatus({
              sessionId,
              status: CoworkSessionStatusValue.Idle,
            }),
          );
        }
        return false;
      } finally {
        setIsResuming(false);
      }
    },
    [dispatch, interruption, isResuming, sessionId],
  );

  return { cancel, interruption, isResuming, resume, select };
};
