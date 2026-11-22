import { expect, test, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import { WorkbenchTaskIpc, type WorkbenchTask } from '../../shared/workbenchTask';
import { registerWorkbenchTaskIpcHandlers } from './ipc';
import type { WorkbenchTaskService } from './taskService';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
  getAllWindows: vi.fn(() => [] as unknown[]),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows, fromWebContents: () => null },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));

test('registers only read-only projection and audit export IPC handlers', () => {
  electronMocks.handlers.clear();
  const service = {
    on: vi.fn(),
    getCurrent: vi.fn(() => null),
    getDetail: vi.fn(() => null),
    listForSession: vi.fn(() => []),
  } as unknown as WorkbenchTaskService;

  registerWorkbenchTaskIpcHandlers({ getService: () => service, getMainWindow: () => null });

  expect([...electronMocks.handlers.keys()]).toEqual([
    WorkbenchTaskIpc.GetCurrent,
    WorkbenchTaskIpc.GetDetail,
    WorkbenchTaskIpc.ListForSession,
    WorkbenchTaskIpc.ExportAudit,
  ]);
});

test('projects Workbench changes only to the current main window', () => {
  const on = vi.fn();
  const service = { on } as unknown as WorkbenchTaskService;
  const makeWindow = () => ({
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn(), isDestroyed: vi.fn(() => false) },
  });
  const main = makeWindow();
  const replacement = makeWindow();
  const other = makeWindow();
  electronMocks.getAllWindows.mockReturnValueOnce([main, other]);
  const getMainWindow = vi
    .fn<() => BrowserWindow | null>()
    .mockReturnValueOnce(main as unknown as BrowserWindow)
    .mockReturnValueOnce(null)
    .mockReturnValue(replacement as unknown as BrowserWindow);
  registerWorkbenchTaskIpcHandlers({ getService: () => service, getMainWindow });
  const notify = on.mock.calls[0][1] as (event: { sessionId: string; taskId: string }) => void;
  const event = { sessionId: 'session', taskId: 'task' };
  notify(event);
  notify(event);
  notify(event);
  replacement.webContents.isDestroyed.mockReturnValue(true);
  notify(event);

  expect(main.webContents.send).toHaveBeenCalledExactlyOnceWith(WorkbenchTaskIpc.Changed, event);
  expect(replacement.webContents.send).toHaveBeenCalledExactlyOnceWith(
    WorkbenchTaskIpc.Changed,
    event,
  );
  expect(other.webContents.send).not.toHaveBeenCalled();
});

test('export audit returns a clean cancellation result from the save dialog', async () => {
  electronMocks.handlers.clear();
  electronMocks.showSaveDialog.mockResolvedValue({ canceled: true });
  const task = { id: 'task-1', sessionId: 'session-1' } as WorkbenchTask;
  const service = {
    on: vi.fn(),
    getDetail: vi.fn(() => ({
      task,
      runs: [],
      events: [],
      artifacts: [],
      approvals: [],
    })),
  } as unknown as WorkbenchTaskService;
  registerWorkbenchTaskIpcHandlers({ getService: () => service, getMainWindow: () => null });

  const handler = electronMocks.handlers.get(WorkbenchTaskIpc.ExportAudit);
  await expect(handler?.({ sender: {} }, task.id)).resolves.toEqual({
    success: true,
    canceled: true,
  });
  expect(electronMocks.showSaveDialog).toHaveBeenCalledWith(
    expect.objectContaining({ defaultPath: `workbench-task-audit-${task.id}.json` }),
  );
});
