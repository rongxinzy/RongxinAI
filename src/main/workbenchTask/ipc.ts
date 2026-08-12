import { BrowserWindow, ipcMain } from 'electron';

import {
  WorkbenchRunTrigger,
  WorkbenchTaskIpc,
  type WorkbenchApprovalResponseInput,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchTaskChangedEvent,
} from '../../shared/workbenchTask';
import type { WorkbenchTaskService } from './taskService';

export function registerWorkbenchTaskIpcHandlers(options: {
  getService: () => WorkbenchTaskService;
  startPreparedRun: (task: WorkbenchTask, run: WorkbenchRun) => Promise<void>;
}): void {
  const service = options.getService();
  service.on('changed', (event: WorkbenchTaskChangedEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(WorkbenchTaskIpc.Changed, event);
    }
  });

  ipcMain.handle(WorkbenchTaskIpc.GetCurrent, (_event, sessionId: string) => ({
    success: true,
    detail: service.getCurrent(sessionId) ?? undefined,
  }));

  ipcMain.handle(WorkbenchTaskIpc.GetDetail, (_event, taskId: string) => {
    const detail = service.getDetail(taskId);
    return detail
      ? { success: true, detail }
      : { success: false, error: 'Workbench task not found.' };
  });

  const startRun = async (taskId: string, trigger: WorkbenchRunTrigger) => {
    try {
      const prepared = service.prepareRun(taskId, trigger);
      await options.startPreparedRun(prepared.task, prepared.run);
      return { success: true, detail: service.getDetail(taskId) ?? undefined };
    } catch (error) {
      const task = service.getDetail(taskId)?.task;
      if (task) {
        service.failRun(task.sessionId, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  ipcMain.handle(WorkbenchTaskIpc.Resume, (_event, taskId: string) =>
    startRun(taskId, WorkbenchRunTrigger.Resume),
  );
  ipcMain.handle(WorkbenchTaskIpc.Retry, (_event, taskId: string) =>
    startRun(taskId, WorkbenchRunTrigger.Retry),
  );

  ipcMain.handle(WorkbenchTaskIpc.Accept, (_event, taskId: string) => {
    try {
      return { success: true, detail: service.acceptTask(taskId) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    WorkbenchTaskIpc.RespondToApproval,
    (_event, input: WorkbenchApprovalResponseInput) => {
      try {
        service.respondToApproval(input);
        const approval = service.repository.getApproval(input.approvalId);
        return {
          success: true,
          detail: approval ? (service.getDetail(approval.taskId) ?? undefined) : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
