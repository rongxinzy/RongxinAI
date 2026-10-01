import { useCallback, useEffect, useState } from 'react';

import type { CoworkSessionInterruption } from '../../../../shared/cowork/interruption';
import type { WorkbenchTaskResumeInput } from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { normalizeError } from '../../../services/errorNormalization';
import { showAppErrorToast } from '../../../services/toastNotification';

export const useTaskResumeContext = (sessionId: string | undefined) => {
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
      const taskId = interruption?.taskId;
      if (!taskId || interruption.sessionId !== sessionId || isResuming) return false;
      const target = interruption;
      setIsResuming(true);
      // 2026/09/17 lixiang  开始继续执行时立刻清掉输入框里的暂停任务嵌入
      setInterruption(null);
      try {
        const result = await window.electron.workbenchTask.resume({
          ...input,
          taskId,
        });
        if (!result.success) {
          showAppErrorToast(
            normalizeError(result.error || i18nService.t('coworkResumeTaskFailed')),
          );
          // 2026/09/17 lixiang  启动失败时恢复嵌入，方便用户重试
          setInterruption(target);
          return false;
        }
        return true;
      } catch {
        showAppErrorToast(i18nService.t('coworkResumeTaskFailed'));
        setInterruption(target);
        return false;
      } finally {
        setIsResuming(false);
      }
    },
    [interruption, isResuming, sessionId],
  );

  return { cancel, interruption, isResuming, resume, select };
};
