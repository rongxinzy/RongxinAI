import { writeFile } from 'fs/promises';

import { BrowserWindow, dialog, ipcMain } from 'electron';

import {
  WorkbenchRunTrigger,
  WorkbenchTaskIpc,
  type WorkbenchApprovalResponseInput,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchTaskChangedEvent,
  type WorkbenchTaskResumeInput,
} from '../../shared/workbenchTask';
import type { WorkbenchTaskService } from './taskService';

export function registerWorkbenchTaskIpcHandlers(options: {
  getService: () => WorkbenchTaskService;
  startPreparedRun: (
    task: WorkbenchTask,
    run: WorkbenchRun,
    resumeInput?: WorkbenchTaskResumeInput,
  ) => Promise<void>;
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

  ipcMain.handle(WorkbenchTaskIpc.ListForSession, (_event, sessionId: string) => ({
    success: true,
    tasks: service.listForSession(sessionId),
  }));

  ipcMain.handle(WorkbenchTaskIpc.ExportAudit, async (event, taskId: string) => {
    try {
      const detail = service.getDetail(taskId);
      if (!detail) return { success: false, error: 'Workbench task not found.' };
      const owner = BrowserWindow.fromWebContents(event.sender);
      const saveOptions = {
        defaultPath: `workbench-task-audit-${detail.task.id}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      };
      const selection = owner
        ? await dialog.showSaveDialog(owner, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
      if (selection.canceled || !selection.filePath) {
        return { success: true, canceled: true };
      }
      await writeFile(
        selection.filePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            detail,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      return { success: true, path: selection.filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const startRun = async (
    taskId: string,
    trigger: WorkbenchRunTrigger,
    resumeInput?: WorkbenchTaskResumeInput,
  ) => {
    try {
      const prepared = service.prepareRun(taskId, trigger);
      await options.startPreparedRun(prepared.task, prepared.run, resumeInput);
      return { success: true, detail: service.getDetail(taskId) ?? undefined };
    } catch (error) {
      const task = service.getDetail(taskId)?.task;
      if (task) {
        const message = error instanceof Error ? error.message : String(error);
        if (trigger === WorkbenchRunTrigger.Resume) {
          service.pauseRun(task.sessionId, message);
        } else {
          service.failRun(task.sessionId, { message });
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  ipcMain.handle(WorkbenchTaskIpc.Resume, (_event, input: WorkbenchTaskResumeInput) =>
    startRun(input.taskId, WorkbenchRunTrigger.Resume, input),
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
