import { useEffect, useState } from 'react';

import { WorkbenchTaskStatus } from '../../../../shared/workbenchTask';

export const useRecoverableWorkbenchTaskId = (sessionId: string | undefined): string | null => {
  const [taskId, setTaskId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    if (!sessionId) {
      setTaskId(null);
      return () => {
        disposed = true;
      };
    }
    const load = async () => {
      const result = await window.electron.workbenchTask.getCurrent(sessionId);
      if (disposed) return;
      const task = result.detail?.task;
      setTaskId(task?.status === WorkbenchTaskStatus.Paused ? task.id : null);
    };

    void load();
    const cleanup = window.electron.workbenchTask.onChanged(event => {
      if (event.sessionId === sessionId) void load();
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [sessionId]);

  return taskId;
};
