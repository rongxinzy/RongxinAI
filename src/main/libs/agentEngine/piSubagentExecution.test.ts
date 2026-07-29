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
} from './piWriteTokenLimit';

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
    timeoutMs: 10_000,
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

  await expect(output).resolves.toBe('Final answer');
});

test('queues Pi write recovery and keeps waiting after a truncated subagent write', async () => {
  const { session, emit, resolvePrompt } = createSession();
  const output = runPiSubagent(session, 'Write a large file', {
    maxOutputTokens: 4096,
    timeoutMs: 10_000,
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

  await expect(output).resolves.toBe('Completed');
});

test('returns a subagent error without waiting for agent_end', async () => {
  const { session, emit } = createSession();
  const output = runPiSubagent(session, 'Fail', {
    maxOutputTokens: 4096,
    timeoutMs: 10_000,
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

  await expect(output).resolves.toBe('Error: provider failed');
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
    runPiSubagent(session, 'Implement it', { maxOutputTokens: 4096, timeoutMs: 10_000 }),
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
    runPiSubagent(session, 'Implement it', { maxOutputTokens: 4096, timeoutMs: 10_000 }),
  ).rejects.toBe(error);
  expect(unsubscribe).toHaveBeenCalledOnce();
});
