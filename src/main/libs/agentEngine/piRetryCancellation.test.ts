import { AgentSession } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';

import { cancelPiRetry, waitForPiRetryCancellation } from './piRetryCancellation';

test('cancels the real SDK backoff and sends the next prompt through its public API', async () => {
  // Replace model I/O only; retain AgentSession.prompt, retry, abort and idle lifecycle.
  const session = Object.create(AgentSession.prototype) as AgentSession;
  const internal = session as unknown as { _lastAssistantMessage: unknown };
  const state = {
    messages: [] as unknown[],
    model: { provider: 'test', contextWindow: 128_000 },
    systemPrompt: '',
  };
  const prompt = vi.fn(async (messages: unknown[]) => {
    state.messages.push(...messages);
    const response =
      prompt.mock.calls.length === 1
        ? {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: '502 invalid api key',
            usage: { input: 0 },
          }
        : { role: 'assistant', content: [], stopReason: 'stop', usage: { input: 0 } };
    state.messages.push(response);
    internal._lastAssistantMessage = response;
  });
  const continueRun = vi.fn();
  Object.assign(session, {
    _isAgentRunActive: false,
    _retryAttempt: 0,
    _eventListeners: [],
    _pendingNextTurnMessages: [],
    _baseSystemPrompt: '',
    _flushPendingBashMessages: () => undefined,
    _checkCompaction: async () => false,
    _extensionRunner: {
      hasHandlers: () => false,
      emit: async () => undefined,
      emitBeforeAgentStart: async () => undefined,
    },
    _modelRuntime: { hasConfiguredAuth: () => true },
    settingsManager: {
      getRetrySettings: () => ({ enabled: true, maxRetries: 3, baseDelayMs: 60_000 }),
    },
    agent: { state, prompt, continue: continueRun, abort: vi.fn(), hasQueuedMessages: () => false },
  });
  const events: string[] = [];
  session.subscribe(event => {
    events.push(event.type);
    if (event.type === 'auto_retry_start') {
      expect(session.isStreaming).toBe(true);
      void cancelPiRetry(session);
    }
  });
  const startedAt = Date.now();
  await session.prompt('first message', { expandPromptTemplates: false });
  await waitForPiRetryCancellation(session);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(events).toEqual(['auto_retry_start', 'auto_retry_end', 'agent_settled']);
  expect(session.isIdle).toBe(true);
  expect(continueRun).not.toHaveBeenCalled();
  await session.prompt('second message', { expandPromptTemplates: false });
  expect(prompt).toHaveBeenCalledTimes(2);
  expect(session.isIdle).toBe(true);
});

test('deduplicates cancellation and holds continuations until abort finishes', async () => {
  let finishAbort: (() => void) | undefined;
  const session = {
    abort: vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishAbort = resolve;
        }),
    ),
  };
  const cancellation = cancelPiRetry(session);
  expect(cancelPiRetry(session)).toBe(cancellation);
  let ready = false;
  const continuation = waitForPiRetryCancellation(session)!.then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(session.abort).toHaveBeenCalledOnce();
  finishAbort!();
  await continuation;
  expect(ready).toBe(true);
});
