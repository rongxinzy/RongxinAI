import { EventEmitter } from 'node:events';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';
import { CodingAgentIpc, CodingEventWindowPageSize } from '../../shared/codingAgent';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import { registerCodingAgentIpcHandlers } from './codingAgent';

afterEach(() => vi.restoreAllMocks());

test('sends Coding Room events only to the live Workbench window', () => {
  vi.spyOn(ipcMain, 'handle').mockImplementation(() => undefined);
  const makeWindow = () => ({
    isDestroyed: vi.fn(() => false),
    webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() },
  });
  const main = makeWindow();
  const other = makeWindow();
  vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([
    main,
    other,
  ] as unknown as BrowserWindow[]);
  const service = new EventEmitter() as unknown as CodingRoomService;
  registerCodingAgentIpcHandlers(
    () => service,
    () => main as unknown as BrowserWindow,
  );
  const events = [
    ['changed', CodingAgentIpc.Changed, { events: [], lanes: [] }],
    ['pendingMessagesChanged', CodingAgentIpc.PendingMessagesChanged, { laneId: 'lane' }],
    ['eventDelta', CodingAgentIpc.EventDelta, { laneId: 'lane', events: [] }],
    ['authTerminalData', CodingAgentIpc.AuthTerminalData, { id: 'terminal', data: 'output' }],
    ['authTerminalExit', CodingAgentIpc.AuthTerminalExit, { id: 'terminal', exitCode: 0 }],
  ] as const;
  for (const [event, , payload] of events) service.emit(event, payload);
  expect(other.webContents.send).not.toHaveBeenCalled();
  expect(main.webContents.send.mock.calls).toEqual(
    events.map(([, channel, payload]) => [channel, payload]),
  );
  main.webContents.isDestroyed.mockReturnValue(true);
  service.emit('authTerminalData', { id: 'terminal', data: 'late' });
  expect(main.webContents.send).toHaveBeenCalledTimes(events.length);
});

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
  registerCodingAgentIpcHandlers(
    () => service as unknown as CodingRoomService,
    () => null,
  );
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
    // Args match each contract schema — writeWorkspaceFile needs the full
    // write payload; getProfileAvailableCommands takes a bare profile id; the
    // rest take a workspace-root-bearing target.
    const args =
      channel === CodingAgentIpc.WriteWorkspaceFile
        ? {
            workspaceRoot: 'workspace',
            path: 'src/a.ts',
            content: 'export {};',
            expectedSha256: '0'.repeat(64),
          }
        : channel === CodingAgentIpc.LoadEventPage
          ? { workspaceRoot: 'workspace', laneId: 'lane-1', beforeSequence: null }
          : channel === CodingAgentIpc.CommitAndPushGitChanges
            ? { workspaceRoot: 'workspace', message: 'fix: lint', paths: [] }
            : channel === CodingAgentIpc.CreateGitBranch
              ? { workspaceRoot: 'workspace', branch: 'feat/x' }
              : channel === CodingAgentIpc.RespondElicitation
                ? { workspaceRoot: 'workspace', response: { requestId: 'req-1', answer: 'yes' } }
                : channel === CodingAgentIpc.CancelElicitation
                  ? { workspaceRoot: 'workspace', requestId: 'req-1' }
                  : channel === CodingAgentIpc.GetProfileAvailableCommands
                    ? 'claude'
                    : { workspaceRoot: 'workspace' };
    expect(await handlers.get(channel)!(event, args)).toEqual({
      success: false,
      error: failure.message,
    });
    expect(log).toHaveBeenLastCalledWith(`[CodingAgentIpc] ${channel} failed:`, failure);
  }
});
