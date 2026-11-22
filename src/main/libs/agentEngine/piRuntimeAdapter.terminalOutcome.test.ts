import {
  createTestPiRuntime,
  adapter,
  mockSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';
import { expect, test, vi } from 'vitest';
import { CoworkErrorKind } from '../../../common/coworkError';
import { PiAssistantStopReason } from './piToolConstants';
import Database from 'better-sqlite3';
import { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { WorkbenchExecutionStatus } from '../../../shared/workbenchTask';

setupPiRuntimeAdapterSuite();

test.each([PiAssistantStopReason.Aborted, PiAssistantStopReason.ToolUse])(
  'settling with %s reports interruption without harness continuation or completion',
  async stopReason => {
    const complete = vi.fn();
    const error = vi.fn();
    adapter.on('complete', complete);
    adapter.on('error', error);
    await adapter.startSession('terminal-failure', 'Finish the task', { sessionMode: 'work' });
    const listener = mockSession.subscribe.mock.calls.at(-1)![0];
    // An earlier normal answer cannot make a later interrupted turn successful.
    for (const reason of [PiAssistantStopReason.Stop, stopReason]) {
      listener({ type: 'turn_start' });
      listener({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Partial result' }],
          stopReason: reason,
        },
      });
      listener({ type: 'agent_end' });
    }
    expect(error).not.toHaveBeenCalled();
    listener({ type: 'agent_settled' });
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(error.mock.calls[0][1].kind).toBe(CoworkErrorKind.StreamInterrupted);
    expect(complete).not.toHaveBeenCalled();
    expect(mockSession.prompt).toHaveBeenCalledOnce();
  },
);

test('settling with length completes without StreamInterrupted when output is truncated at maxTokens', async () => {
  const complete = vi.fn();
  const error = vi.fn();
  adapter.on('complete', complete);
  adapter.on('error', error);
  await adapter.startSession('terminal-length', 'Finish the task', { sessionMode: 'work' });
  const listener = mockSession.subscribe.mock.calls.at(-1)![0];
  listener({ type: 'turn_start' });
  listener({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Truncated result' }],
      stopReason: PiAssistantStopReason.Length,
    },
  });
  listener({ type: 'agent_end' });
  listener({ type: 'agent_settled' });
  await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(error).not.toHaveBeenCalled();
});

test('a native continuation can recover length before settlement', async () => {
  const complete = vi.fn();
  const error = vi.fn();
  adapter.on('complete', complete);
  adapter.on('error', error);
  await adapter.startSession('terminal-recovered', 'Finish the task', { sessionMode: 'work' });
  const listener = mockSession.subscribe.mock.calls.at(-1)![0];
  for (const stopReason of [PiAssistantStopReason.Length, PiAssistantStopReason.Stop]) {
    listener({ type: 'turn_start' });
    listener({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Result' }], stopReason },
    });
    listener({ type: 'agent_end' });
    expect(complete).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  }
  listener({ type: 'agent_settled' });
  await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(error).not.toHaveBeenCalled();
  expect(mockSession.prompt).toHaveBeenCalledOnce();
});

test('a settled response completes directly without a workbench verification gate', async () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  const service = new WorkbenchTaskService(db);
  const adapter = createTestPiRuntime({ workbenchTaskService: service });
  const complete = vi.fn();
  const error = vi.fn();
  adapter.on('complete', complete);
  adapter.on('error', error);
  try {
    await adapter.startSession('direct-completion', 'Finish the task', { sessionMode: 'work' });
    const listener = mockSession.subscribe.mock.calls.at(-1)![0];
    listener({ type: 'turn_start' });
    listener({
      type: 'message_end',
      message: { role: 'assistant', content: [], stopReason: PiAssistantStopReason.Stop },
    });
    listener({ type: 'agent_settled' });
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(error).not.toHaveBeenCalled();
    expect(service.getCurrent('direct-completion')!.runs[0].status).toBe(
      WorkbenchExecutionStatus.Settled,
    );
  } finally {
    adapter.stopAllSessions();
    db.close();
  }
});

test('Pi settles a failure on its own run when another run was reserved later', async () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  const service = new WorkbenchTaskService(db);
  const runtime = createTestPiRuntime({ workbenchTaskService: service });
  runtime.on('error', vi.fn());
  const sessionId = 'scoped-failure';
  try {
    await runtime.startSession(sessionId, 'First run', { sessionMode: 'work' });
    const running = service.getCurrent(sessionId)!.runs[0];
    const reserved = service.reserveRun({ sessionId, goal: 'Reserved' });
    const listener = mockSession.subscribe.mock.calls.at(-1)![0];
    listener({ type: 'turn_start' });
    listener({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: PiAssistantStopReason.Aborted,
      },
    });
    listener({ type: 'agent_settled' });
    expect(service.repository.getRun(running.id)?.status).toBe(WorkbenchExecutionStatus.Failed);
    expect(service.repository.getRun(reserved.runId)?.status).toBe(WorkbenchExecutionStatus.Queued);
  } finally {
    runtime.stopAllSessions();
    db.close();
  }
});

test('a rejected native continuation ends its Workbench run', async () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  const service = new WorkbenchTaskService(db);
  const runtime = createTestPiRuntime({ workbenchTaskService: service });
  runtime.on('error', vi.fn());
  const sessionId = 'rejected-continuation';
  try {
    await runtime.startSession(sessionId, 'First run', { sessionMode: 'work' });
    mockSession.subscribe.mock.calls.at(-1)![0]({ type: 'agent_settled' });
    mockSession.prompt.mockRejectedValueOnce(new Error('Rejected before native settlement'));
    await expect(runtime.continueSession(sessionId, 'Second run')).rejects.toThrow(
      'Rejected before native settlement',
    );
    const run = service.getCurrent(sessionId)!.runs[0];
    expect(run.status).toBe(WorkbenchExecutionStatus.Failed);
    expect(run.failure).toEqual({ message: 'Rejected before native settlement' });
  } finally {
    runtime.stopAllSessions();
    db.close();
  }
});
