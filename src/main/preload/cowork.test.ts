import { afterEach, describe, expect, test, vi } from 'vitest';

import { ipcRenderer } from 'electron';

import { TodoIpc } from '../../shared/todo';
import { WorkbenchTaskIpc } from '../../shared/workbenchTask';
import { CoworkStreamIpc } from '../../shared/ipc/channels';
import { coworkApi } from './cowork';

afterEach(() => {
  vi.restoreAllMocks();
  ipcRenderer.removeAllListeners();
});

describe('coworkApi contract invokers', () => {
  test('cowork invoke methods forward to the contract channels', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });

    await coworkApi.cowork.getSession('session-1');
    expect(invoke).toHaveBeenCalledWith('cowork:session:get', 'session-1');

    // Optional trailing tuple element is simply absent at runtime.
    await coworkApi.cowork.getSession('session-1', { messageLimit: null });
    expect(invoke).toHaveBeenLastCalledWith('cowork:session:get', 'session-1', {
      messageLimit: null,
    });

    await coworkApi.cowork.renameSession({ sessionId: 'session-1', title: 'Renamed' });
    expect(invoke).toHaveBeenLastCalledWith('cowork:session:rename', {
      sessionId: 'session-1',
      title: 'Renamed',
    });

    await coworkApi.cowork.getConfig();
    expect(invoke).toHaveBeenLastCalledWith('cowork:config:get');
  });

  test('cowork queue and workspace methods keep their payload arity', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });

    const payload = { sessionId: 'session-1', itemId: 'q-1' };
    await coworkApi.cowork.steerPendingMessage(payload);
    expect(invoke).toHaveBeenLastCalledWith('cowork:queue:steer', payload);
    expect(invoke.mock.calls[0]).toHaveLength(2);

    await coworkApi.cowork.renameWorkspace('workspace-1', 'Renamed');
    expect(invoke).toHaveBeenLastCalledWith('cowork:workspace:rename', 'workspace-1', 'Renamed');
  });

  test('workbenchTask invoke methods forward to the contract channels', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });

    await coworkApi.workbenchTask.getCurrent('session-1');
    expect(invoke).toHaveBeenCalledWith(WorkbenchTaskIpc.GetCurrent, 'session-1');

    const resume = { taskId: 'task-1', amendment: 'keep going' };
    await coworkApi.workbenchTask.resume(resume);
    expect(invoke).toHaveBeenLastCalledWith(WorkbenchTaskIpc.Resume, resume);

    await coworkApi.workbenchTask.respondToApproval({ approvalId: 'appr-1', approved: true });
    expect(invoke).toHaveBeenLastCalledWith(WorkbenchTaskIpc.RespondToApproval, {
      approvalId: 'appr-1',
      approved: true,
    });
  });

  test('todo invoke methods forward to the contract channels', async () => {
    const invoke = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });

    await coworkApi.todo.list({ view: 'all' });
    expect(invoke).toHaveBeenCalledWith(TodoIpc.List, { view: 'all' });

    await coworkApi.todo.delete('todo-1');
    expect(invoke).toHaveBeenLastCalledWith(TodoIpc.Delete, 'todo-1');

    await coworkApi.todo.listLists();
    expect(invoke).toHaveBeenLastCalledWith(TodoIpc.ListLists);
    expect(invoke.mock.calls[2]).toHaveLength(1);
  });

  test('push subscriptions stay wired to their channels', async () => {
    const subscribe = vi.spyOn(ipcRenderer, 'invoke').mockResolvedValue({ success: true });
    const on = vi.fn().mockReturnValue(() => undefined);
    vi.spyOn(ipcRenderer, 'on').mockImplementation(on);

    expect(typeof coworkApi.cowork.onStreamRunState).toBe('function');
    expect(typeof coworkApi.cowork.onStreamUiEvent).toBe('function');
    expect(typeof coworkApi.cowork.onSessionsChanged).toBe('function');
    expect(typeof coworkApi.workbenchTask.onChanged).toBe('function');
    expect(typeof coworkApi.todo.onChanged).toBe('function');

    const cleanup = coworkApi.cowork.onStreamUiEvent(() => undefined);
    expect(on).toHaveBeenCalledWith(CoworkStreamIpc.UiEvent, expect.any(Function));
    expect(typeof cleanup).toBe('function');
    expect(subscribe).not.toHaveBeenCalled();
  });
});
