import { writeFile } from 'fs/promises';

import { BrowserWindow, dialog } from 'electron';

import { WorkbenchTaskIpc, type WorkbenchTaskChangedEvent } from '../../shared/workbenchTask';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { workbenchTaskContract } from '../../shared/ipc/workbenchTaskContract';
import type { WorkbenchTaskService } from './taskService';

export function registerWorkbenchTaskIpcHandlers(options: {
  getService: () => WorkbenchTaskService;
}): void {
  const service = options.getService();
  service.on('changed', (event: WorkbenchTaskChangedEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(WorkbenchTaskIpc.Changed, event);
    }
  });

  handleIpcContract(workbenchTaskContract, {
    getCurrent: (_event, sessionId) => ({
      success: true,
      detail: service.getCurrent(sessionId) ?? undefined,
    }),

    getDetail: (_event, taskId) => {
      const detail = service.getDetail(taskId);
      return detail
        ? { success: true, detail }
        : { success: false, error: 'Workbench task not found.' };
    },

    listForSession: (_event, sessionId) => ({
      success: true,
      tasks: service.listForSession(sessionId),
    }),

    exportAudit: async (event, taskId) => {
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
    },
  });
}
