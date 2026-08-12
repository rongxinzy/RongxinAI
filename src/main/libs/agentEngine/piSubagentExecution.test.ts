import { expect, test, vi } from 'vitest';

import {
  extractPiSubagentExecutionMetadata,
  PiMessageRole,
  PiSubagentEventType,
  runPiSubagent,
  type PiSubagentSession,
} from './piSubagentExecution';
import {
  PiAssistantStopReason,
  PiBuiltinFileToolName,
  PiContentBlockType,
} from './piWriteTokenLimit';

test('extracts validated execution metadata from a subagent tool result', () => {
  expect(
    extractPiSubagentExecutionMetadata({
      details: {
        execution: {
          terminationReason: 'hard_timeout',
          durationMs: 180_000,
          assistantTurns: 6,
          toolCalls: 5,
          steerRequested: true,
        },
      },
    }),
  ).toEqual({
    terminationReason: 'hard_timeout',
    durationMs: 180_000,
    assistantTurns: 6,
    toolCalls: 5,
    steerRequested: true,
  });
  expect(
    extractPiSubagentExecutionMetadata({
      details: { execution: { terminationReason: 'unknown' } },
    }),
  ).toBeUndefined();
});

const createSession = () => {
  let listener: ((event: { type: string; message?: never }) => void) | undefined;
  let resolvePrompt: (() => void) | undefined;
  const session: PiSubagentSession = {
    prompt: vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolvePrompt = resolve;
        }),
    ),
    steer: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(callback => {
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

test('waits for agent_settled instead of returning after an intermediate assistant message', async () => {
  const { session, emit, resolvePrompt } = createSession();
  let settled = false;
  const output = runPiSubagent(session, 'Implement it', {
    maxOutputTokens: 4096,
    hardTimeoutMs: 10_000,
  }).then(value => {
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
    steerRequested: false,
  });
});

test('queues Pi write recovery and keeps waiting after a truncated subagent write', async () => {
  const { session, emit, resolvePrompt } = createSession();
  const output = runPiSubagent(session, 'Write a large file', {
    maxOutputTokens: 4096,
    hardTimeoutMs: 10_000,
  });

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
  expect(session.steer).toHaveBeenCalledOnce();

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

test('returns a subagent error without waiting for agent_end', async () => {
  const { session, emit } = createSession();
  const output = runPiSubagent(session, 'Fail', {
    maxOutputTokens: 4096,
    hardTimeoutMs: 10_000,
  });

  emit({
    type: PiSubagentEventType.MessageEnd,
    message: {
      role: PiMessageRole.Assistant,
      stopReason: PiAssistantStopReason.Error,
      errorMessage: 'provider failed',
      content: [],
    },
  });

  await expect(output).resolves.toMatchObject({
    output: 'Error: provider failed',
    terminationReason: 'error',
  });
});

test('cleans up when subscribing throws synchronously', async () => {
  const error = new Error('subscribe failed');
  const session: PiSubagentSession = {
    prompt: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => {
      throw error;
    }),
  };

  await expect(
    runPiSubagent(session, 'Implement it', {
      maxOutputTokens: 4096,
      hardTimeoutMs: 10_000,
    }),
  ).rejects.toBe(error);
  expect(session.prompt).not.toHaveBeenCalled();
});

test('cleans up when prompting throws synchronously', async () => {
  const error = new Error('prompt failed');
  const unsubscribe = vi.fn();
  const session: PiSubagentSession = {
    prompt: vi.fn(() => {
      throw error;
    }),
    steer: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => unsubscribe),
  };

  await expect(
    runPiSubagent(session, 'Implement it', {
      maxOutputTokens: 4096,
      hardTimeoutMs: 10_000,
    }),
  ).rejects.toBe(error);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('requests at most one bounded steer when review budgets are exhausted', async () => {
  const { session, emit, resolvePrompt } = createSession();
  const output = runPiSubagent(session, 'Review it', {
    maxOutputTokens: 4096,
    hardTimeoutMs: 10_000,
    maxAssistantTurns: 2,
    maxToolCalls: 1,
    steerPrompt: 'Return the verdict now.',
  });

  emit({ type: PiSubagentEventType.ToolExecutionStart });
  emit({ type: PiSubagentEventType.ToolExecutionStart });
  for (const text of ['First', 'Final']) {
    emit({
      type: PiSubagentEventType.MessageEnd,
      message: {
        role: PiMessageRole.Assistant,
        stopReason: PiAssistantStopReason.Stop,
        content: [{ type: PiContentBlockType.Text, text }],
      },
    });
  }
  emit({ type: PiSubagentEventType.AgentSettled });
  resolvePrompt();

  expect(session.steer).toHaveBeenCalledOnce();
  await expect(output).resolves.toMatchObject({
    output: 'Final',
    terminationReason: 'settled',
    assistantTurns: 2,
    toolCalls: 2,
    steerRequested: true,
  });
});

test('steers once without terminating when an external review budget is exhausted', async () => {
  const { session, emit, resolvePrompt } = createSession();
  let signalLimitExceeded = (): void => {};
  const unsubscribeSignal = vi.fn();
  const output = runPiSubagent(session, 'Review it', {
    maxOutputTokens: 4096,
    hardTimeoutMs: 10_000,
    steerPrompt: 'Return the verdict now.',
    steerSignal: {
      subscribeLimitExceeded: listener => {
        signalLimitExceeded = listener;
        return unsubscribeSignal;
      },
    },
  });

  signalLimitExceeded();
  signalLimitExceeded();
  expect(session.steer).toHaveBeenCalledOnce();

  emit({ type: PiSubagentEventType.AgentSettled });
  resolvePrompt();
  await expect(output).resolves.toMatchObject({
    terminationReason: 'settled',
    steerRequested: true,
  });
  expect(unsubscribeSignal).toHaveBeenCalledOnce();
});

test('steers at the soft timeout and returns structured hard-timeout metadata', async () => {
  vi.useFakeTimers();
  try {
    const { session } = createSession();
    const output = runPiSubagent(session, 'Review it', {
      maxOutputTokens: 4096,
      softTimeoutMs: 120_000,
      hardTimeoutMs: 180_000,
      steerPrompt: 'Return the verdict now.',
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(session.steer).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(output).resolves.toMatchObject({
      output: '(subagent hard timeout after 180s)',
      terminationReason: 'hard_timeout',
      durationMs: 180_000,
      assistantTurns: 0,
      toolCalls: 0,
      steerRequested: true,
    });
  } finally {
    vi.useRealTimers();
  }
});
