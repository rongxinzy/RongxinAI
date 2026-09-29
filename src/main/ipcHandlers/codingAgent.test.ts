import { EventEmitter } from 'node:events';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';
import { CodingAgentIpc, CodingEventWindowPageSize } from '../../shared/codingAgent';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import { registerCodingAgentIpcHandlers } from './codingAgent';

afterEach(() => vi.restoreAllMocks());

test('registers each channel once and retains target paging, editing and composite Git operations', async () => {
  const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>();
  vi.spyOn(ipcMain, 'handle').mockImplementation((channel, handler) => {
    expect(handlers.has(channel), `duplicate ${channel}`).toBe(false);
    handlers.set(channel, handler);
  });
  const failure = new Error('operation failed');
  const service = Object.assign(new EventEmitter(), {
    bootstrap: vi.fn(() => ({ events: [] })),
    writeWorkspaceFile: vi.fn(async () => {
      throw failure;
    }),
    loadEventPage: vi.fn(() => {
      throw failure;
    }),
    commitAndPushGitChanges: vi.fn(async () => {
      throw failure;
    }),
    getProfileAvailableCommands: vi.fn(() => {
      throw failure;
    }),
    createGitBranch: vi.fn(async () => {
      throw failure;
    }),
    respondElicitation: vi.fn(async () => {
      throw failure;
    }),
    cancelElicitation: vi.fn(async () => {
      throw failure;
    }),
  });
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  registerCodingAgentIpcHandlers(() => service as unknown as CodingRoomService);
  const event = {} as IpcMainInvokeEvent;
  expect(await handlers.get(CodingAgentIpc.Bootstrap)!(event, 'workspace')).toEqual({
    success: true,
    snapshot: { events: [] },
  });
  expect(service.bootstrap).toHaveBeenCalledWith('workspace', {
    eventLimitPerLane: CodingEventWindowPageSize,
  });
  for (const channel of [
    CodingAgentIpc.WriteWorkspaceFile,
    CodingAgentIpc.LoadEventPage,
    CodingAgentIpc.CommitAndPushGitChanges,
    CodingAgentIpc.GetProfileAvailableCommands,
    CodingAgentIpc.CreateGitBranch,
    CodingAgentIpc.RespondElicitation,
    CodingAgentIpc.CancelElicitation,
  ]) {
    expect(handlers.has(channel)).toBe(true);
    expect(await handlers.get(channel)!(event, { paths: [] })).toEqual({
      success: false,
      error: failure.message,
    });
    expect(log).toHaveBeenLastCalledWith(`[CodingAgentIpc] ${channel} failed:`, failure);
  }
});
