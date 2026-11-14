import { expect, test, vi } from 'vitest';

import {
  PiMessageRole,
  PiSubagentEventType,
  runPiSubagent,
  type PiSubagentSession,
} from './piSubagentExecution';
import {
  PiAssistantStopReason,
  PiBuiltinFileToolName,
  PiContentBlockType,
} from './piToolConstants';

const createSession = () => {
  let listener: ((event: { type: string; message?: never }) => void) | undefined;
  let resolvePrompt: (() => void) | undefined;
  const session = {
    prompt: vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolvePrompt = resolve;
        }),
    ),
    steer: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((callback: Parameters<PiSubagentSession['subscribe']>[0]) => {
      listener = callback as typeof listener;
      return vi.fn();
    }),
  };
  return {
    session,
    emit: (event: object) => listener?.(event as never),
    resolvePrompt: () => resolvePrompt?.(),
  };
};

test('cancels the wait immediately and never starts an already-cancelled request', async () => {
  const { session } = createSession();
  const controller = new AbortController();
  const cancelled = new Error('stopped');
  const output = runPiSubagent(session, 'work', { signal: controller.signal });
  const assertion = expect(output).rejects.toBe(cancelled);
  controller.abort(cancelled);
  await assertion;
  vi.mocked(session.prompt).mockClear();
  await expect(runPiSubagent(session, 'work', { signal: controller.signal })).rejects.toBe(
    cancelled,
  );
  expect(session.prompt).not.toHaveBeenCalled();
});

test('allows long native work without a default wall-clock cutoff', async () => {
  vi.useFakeTimers();
  try {
    const { session, emit } = createSession();
    const output = runPiSubagent(session, 'long work', {});
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(session.steer).not.toHaveBeenCalled();
    emit({ type: PiSubagentEventType.AgentSettled });
    await expect(output).resolves.toMatchObject({
      terminationReason: 'settled',
      durationMs: 3_600_000,
    });
  } finally {
    vi.useRealTimers();
  }
});

test('waits for agent_settled instead of returning after an intermediate assistant message', async () => {
  const { session, emit, resolvePrompt } = createSession();
  let settled = false;
  const output = runPiSubagent(session, 'Implement it', {}).then(value => {
    settled = true;
    return value;
  });

  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.Text, text: 'Intermediate' }],
    },
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.Text, text: 'Final answer' }],
    },
  });
  emit({ type: PiSubagentEventType.AgentEnd });
  resolvePrompt();
  await Promise.resolve();
  expect(settled).toBe(false);

  emit({ type: PiSubagentEventType.AgentSettled });

  await expect(output).resolves.toMatchObject({
    output: 'Final answer',
    terminationReason: 'settled',
    assistantTurns: 2,
    toolCalls: 0,
  });
});

test('leaves truncated write recovery to the native session', async () => {
  const { session, emit, resolvePrompt } = createSession();
  const output = runPiSubagent(session, 'Write a large file', {});

  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Length,
      content: [
        {
          type: PiContentBlockType.ToolCall,
          id: 'write-1',
          name: PiBuiltinFileToolName.Write,
          arguments: { path: 'large.md', content: 'partial' },
        },
      ],
    },
  });
  expect(session.prompt).toHaveBeenCalledOnce();
  expect(session.steer).not.toHaveBeenCalled();

  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.Text, text: 'Completed' }],
    },
  });
  emit({ type: PiSubagentEventType.AgentEnd });
  emit({ type: PiSubagentEventType.AgentSettled });
  resolvePrompt();

  await expect(output).resolves.toMatchObject({ output: 'Completed' });
});

test('returns the final provider error only after the session settles', async () => {
  const { session, emit } = createSession();
  const output = runPiSubagent(session, 'Fail', {});

  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Error,
      errorMessage: 'provider failed',
      content: [],
    },
  });

  emit({ type: PiSubagentEventType.AgentSettled });

  await expect(output).resolves.toMatchObject({
    output: 'Error: provider failed',
    terminationReason: 'error',
  });
});

test('allows Pi to retry a transient provider error before cleanup', async () => {
  const { session, emit } = createSession();
  const done = vi.fn();
  const output = runPiSubagent(session, 'Retry', {}).then(result => {
    done();
    return result;
  });
  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Error,
      errorMessage: '429 rate limit',
      content: [],
    },
  });
  emit({ type: PiSubagentEventType.AgentEnd });
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.Text, text: 'Recovered answer' }],
    },
  });
  emit({ type: PiSubagentEventType.AgentSettled });
  await expect(output).resolves.toMatchObject({
    output: 'Recovered answer',
    terminationReason: 'settled',
  });
});

test('cleans up when subscribing throws synchronously', async () => {
  const error = new Error('subscribe failed');
  const session: PiSubagentSession = {
    prompt: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => {
      throw error;
    }),
  };

  await expect(runPiSubagent(session, 'Implement it', {})).rejects.toBe(error);
  expect(session.prompt).not.toHaveBeenCalled();
});

test('cleans up when prompting throws synchronously', async () => {
  const error = new Error('prompt failed');
  const unsubscribe = vi.fn();
  const session: PiSubagentSession = {
    prompt: vi.fn(() => {
      throw error;
    }),
    subscribe: vi.fn(() => unsubscribe),
  };

  await expect(runPiSubagent(session, 'Implement it', {})).rejects.toBe(error);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('forwards child tool events tagged with parentToolCallId to onChildToolEvent', async () => {
  const { session, emit, resolvePrompt } = createSession();
  const forwardedEvents: unknown[] = [];
  const onChildToolEvent = vi.fn((event: unknown) => {
    forwardedEvents.push(event);
  });

  const outputPromise = runPiSubagent(session, 'Task with child tools', {
    parentToolCallId: 'parent-call-999',
    onChildToolEvent,
  });

  emit({
    type: PiSubagentEventType.ToolExecutionStart,
    toolCallId: 'child-call-1',
    toolName: 'read',
    args: { path: 'foo.ts' },
  });

  emit({
    type: PiSubagentEventType.ToolExecutionUpdate,
    toolCallId: 'child-call-1',
    toolName: 'read',
    partialResult: 'reading chunk...',
  });

  emit({
    type: PiSubagentEventType.ToolExecutionEnd,
    toolCallId: 'child-call-1',
    toolName: 'read',
    result: 'file content',
    isError: false,
  });

  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.Text, text: 'Child done' }],
    },
  });
  emit({ type: PiSubagentEventType.AgentSettled });
  resolvePrompt();

  const result = await outputPromise;
  expect(result.output).toBe('Child done');
  expect(result.toolCalls).toBe(1);

  expect(onChildToolEvent).toHaveBeenCalledTimes(3);
  expect(forwardedEvents[0]).toEqual({
    type: PiSubagentEventType.ToolExecutionStart,
    toolCallId: 'child-call-1',
    parentToolCallId: 'parent-call-999',
    toolName: 'read',
    args: { path: 'foo.ts' },
    result: undefined,
    partialResult: undefined,
    isError: undefined,
  });
  expect(forwardedEvents[1]).toEqual({
    type: PiSubagentEventType.ToolExecutionUpdate,
    toolCallId: 'child-call-1',
    parentToolCallId: 'parent-call-999',
    toolName: 'read',
    args: undefined,
    result: undefined,
    partialResult: 'reading chunk...',
    isError: undefined,
  });
  expect(forwardedEvents[2]).toEqual({
    type: PiSubagentEventType.ToolExecutionEnd,
    toolCallId: 'child-call-1',
    parentToolCallId: 'parent-call-999',
    toolName: 'read',
    args: undefined,
    result: 'file content',
    partialResult: undefined,
    isError: false,
  });
});
