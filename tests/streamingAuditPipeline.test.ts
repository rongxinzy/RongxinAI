/**
 * Ported streaming audit scenarios (SQLite-backed harness + renderer pipeline).
 */
import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { PiTurnBuilder, PiUiEventType } from './helpers/streamingPipelineHarness';
import {
  assertNothingStreaming,
  assistantRows,
  createAuditHarness,
  dbAssistants,
  emitAssistantError,
  streamText,
} from './helpers/streamingAuditHelpers';
import { adapter } from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { describe, expect, it } from 'vitest';

describe('streaming audit pipeline', () => {
  setupPiRuntimeAdapterSuite();

  it('A3 non-retryable 401 finalizes streamed text and clears streaming flags', async () => {
    const sessionId = 'audit-a3';
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    const text = 'Streamed answer before auth failure';
    const builder = new PiTurnBuilder();
    try {
      harness.emitPi(builder.agentStart());
      harness.emitPi(builder.turnStart());
      harness.emitPi(builder.messageStart());
      streamText(harness, builder, 0, text);
      emitAssistantError(harness, builder, '401 invalid api key');
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: false });
      harness.emitPi(builder.agentSettled());
      harness.settle();
      expect(assistantRows(harness)[0]?.shown).toBe(text);
      assertNothingStreaming(harness, store, sessionId);
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('A4 user stop mid-stream keeps partial text and clears streaming', async () => {
    const sessionId = 'audit-a4';
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    const text = 'Partial answer before the user stops the session';
    const builder = new PiTurnBuilder();
    try {
      harness.emitPi(builder.agentStart());
      harness.emitPi(builder.turnStart());
      harness.emitPi(builder.messageStart());
      streamText(harness, builder, 0, text);
      adapter.stopSession(sessionId);
      harness.emitPi(builder.messageEnd('aborted'));
      harness.emitPi(builder.turnEnd());
      harness.emitPi(builder.agentEnd());
      harness.emitPi({ type: 'agent_settled', aborted: true });
      harness.settle();
      const shown = assistantRows(harness).find(row => !row.thinking)?.shown ?? '';
      expect(shown.length).toBeGreaterThan(0);
      assertNothingStreaming(harness, store, sessionId);
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('A9 401 then queued follow-up turn (turn_end → turn_start, no agent_end between)', async () => {
    const sessionId = 'audit-a9';
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    const first = 'First turn answer text that hit an error';
    const second = 'Second turn answer.';
    const b1 = new PiTurnBuilder();
    const b2 = new PiTurnBuilder();
    try {
      harness.emitPi(b1.agentStart());
      harness.emitPi(b1.turnStart());
      harness.emitPi(b1.messageStart());
      streamText(harness, b1, 0, first);
      emitAssistantError(harness, b1, '401 invalid api key');
      harness.emitPi(b2.turnStart());
      harness.emitPi(b2.messageStart());
      streamText(harness, b2, 0, second, 2);
      harness.emitPi(b2.messageEnd());
      harness.emitPi(b2.turnEnd());
      harness.emitPi({ type: 'agent_end', messages: [] });
      harness.emitPi(b2.agentSettled());
      harness.settle();
      const db = dbAssistants(store, sessionId);
      expect(db.some(row => row.content === first && !row.streaming)).toBe(true);
      expect(db.some(row => row.content === second && !row.streaming)).toBe(true);
      assertNothingStreaming(harness, store, sessionId);
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  async function runTwoTurnErrorFollowUp(sessionId: string, errorMessage: string): Promise<void> {
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    const b1 = new PiTurnBuilder();
    const b2 = new PiTurnBuilder();
    try {
      harness.emitPi(b1.agentStart());
      harness.emitPi(b1.turnStart());
      harness.emitPi(b1.messageStart());
      harness.emitPi(b1.beginThinkingPart(0));
      harness.emitPi(b1.appendThinking(0, 'first thinking'));
      harness.tick(20);
      harness.emitPi(b1.endThinkingPart(0));
      streamText(harness, b1, 1, 'First answer', 1);
      emitAssistantError(harness, b1, errorMessage);
      harness.emitPi(b2.turnStart());
      harness.emitPi(b2.messageStart());
      streamText(harness, b2, 0, 'Second answer.', 2);
      harness.emitPi(b2.messageEnd());
      harness.emitPi(b2.turnEnd());
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: false });
      harness.emitPi(b2.agentSettled());
      harness.settle();
      assertNothingStreaming(harness, store, sessionId);
    } finally {
      harness.dispose();
      cleanup();
    }
  }

  it('A9b unknown error then queued follow-up leaves nothing streaming', async () => {
    await runTwoTurnErrorFollowUp('audit-a9b', 'something odd happened in the provider');
  });

  it('A9c 503 without Pi retry then queued follow-up leaves nothing streaming', async () => {
    await runTwoTurnErrorFollowUp('audit-a9c', '503 Service Unavailable');
  });

  async function runTerminalErrorScenario(
    sessionId: string,
    errorMessage: string,
    options?: { thinkOnly?: boolean },
  ): Promise<void> {
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    const builder = new PiTurnBuilder();
    try {
      harness.emitPi(builder.agentStart());
      harness.emitPi(builder.turnStart());
      harness.emitPi(builder.messageStart());
      harness.emitPi(builder.beginThinkingPart(0));
      harness.emitPi(builder.appendThinking(0, 'pondering'));
      harness.tick(20);
      harness.emitPi(builder.endThinkingPart(0));
      if (!options?.thinkOnly) {
        streamText(harness, builder, 1, 'Partial answer before failure', 3);
      }
      emitAssistantError(harness, builder, errorMessage);
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: false });
      harness.emitPi(builder.agentSettled());
      harness.settle();
      assertNothingStreaming(harness, store, sessionId);
    } finally {
      harness.dispose();
      cleanup();
    }
  }

  it('A10a 401 with thinking and text', () =>
    runTerminalErrorScenario('audit-a10a', '401 invalid api key'));
  it('A10b 401 thinking only', () =>
    runTerminalErrorScenario('audit-a10b', '401 invalid api key', { thinkOnly: true }));
  it('A10c unknown error', () =>
    runTerminalErrorScenario('audit-a10c', 'something odd happened in the provider'));
  it('A10d 503 without retry', () =>
    runTerminalErrorScenario('audit-a10d', '503 Service Unavailable'));

  it('A11 two retries then success keeps one answer bubble with final text', async () => {
    const sessionId = 'audit-a11';
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    const finalText = 'Final recovered answer.';
    try {
      const b1 = new PiTurnBuilder();
      harness.emitPi(b1.agentStart());
      harness.emitPi(b1.turnStart());
      harness.emitPi(b1.messageStart());
      streamText(harness, b1, 0, 'Attempt one partial text');
      emitAssistantError(harness, b1, '503 Service Unavailable');
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: true });
      harness.emitPi({ type: 'auto_retry_start', attempt: 1 });
      const b2 = new PiTurnBuilder();
      harness.emitPi(b2.turnStart());
      harness.emitPi(b2.messageStart());
      streamText(harness, b2, 0, 'Attempt two partial', 2);
      emitAssistantError(harness, b2, '503 Service Unavailable');
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: true });
      harness.emitPi({ type: 'auto_retry_start', attempt: 2 });
      const b3 = new PiTurnBuilder();
      harness.emitPi(b3.turnStart());
      harness.emitPi(b3.messageStart());
      streamText(harness, b3, 0, finalText, 9);
      harness.emitPi(b3.messageEnd());
      harness.emitPi({ type: 'auto_retry_end', success: true, attempt: 2 });
      harness.emitPi(b3.turnEnd());
      harness.emitPi({ type: 'agent_end', messages: [] });
      harness.emitPi(b3.agentSettled());
      harness.settle();
      const answers = dbAssistants(store, sessionId).filter(
        row => !row.thinking && row.content.trim(),
      );
      expect(answers.length).toBe(1);
      expect(answers[0]?.content).toBe(finalText);
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('A12 exhausted retry surfaces error without stuck streaming', async () => {
    const sessionId = 'audit-a12';
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    try {
      const b1 = new PiTurnBuilder();
      harness.emitPi(b1.agentStart());
      harness.emitPi(b1.turnStart());
      harness.emitPi(b1.messageStart());
      streamText(harness, b1, 0, 'Attempt one partial text');
      emitAssistantError(harness, b1, '503 Service Unavailable');
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: true });
      harness.emitPi({ type: 'auto_retry_start', attempt: 1 });
      const b2 = new PiTurnBuilder();
      harness.emitPi(b2.turnStart());
      harness.emitPi(b2.messageStart());
      streamText(harness, b2, 0, 'Attempt two partial', 2);
      emitAssistantError(harness, b2, '503 Service Unavailable');
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: false });
      harness.emitPi({ type: 'auto_retry_end', success: false, attempt: 1, finalError: '503' });
      harness.emitPi(b2.agentSettled());
      harness.settle();
      assertNothingStreaming(harness, store, sessionId);
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('A12b final retry with no answer text does not persist an empty answer row', async () => {
    const sessionId = 'audit-a12b';
    const { store, cleanup, harness } = await createAuditHarness(sessionId);
    try {
      const b1 = new PiTurnBuilder();
      harness.emitPi(b1.agentStart());
      harness.emitPi(b1.turnStart());
      harness.emitPi(b1.messageStart());
      streamText(harness, b1, 0, 'Attempt one partial text');
      emitAssistantError(harness, b1, '503 Service Unavailable');
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: true });
      harness.emitPi({ type: 'auto_retry_start', attempt: 1 });
      const b2 = new PiTurnBuilder();
      harness.emitPi(b2.turnStart());
      harness.emitPi(b2.messageStart());
      harness.emitPi(b2.beginThinkingPart(0));
      harness.emitPi(b2.appendThinking(0, 'try two'));
      harness.tick(20);
      harness.emitPi(b2.endThinkingPart(0));
      emitAssistantError(harness, b2, '503 Service Unavailable');
      harness.emitPi({ type: 'agent_end', messages: [], willRetry: false });
      harness.emitPi({ type: 'auto_retry_end', success: false, attempt: 1, finalError: '503' });
      harness.emitPi(b2.agentSettled());
      harness.settle();
      const emptyAnswers = dbAssistants(store, sessionId).filter(
        row => !row.thinking && row.content.trim().length === 0,
      );
      expect(emptyAnswers).toHaveLength(0);
      expect(dbAssistants(store, sessionId).every(row => !row.streaming)).toBe(true);
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('retry turn_start keeps visible text before new deltas arrive', async () => {
    const sessionId = 'audit-retry-visible';
    const { harness } = await createAuditHarness(sessionId);
    const partial = 'Part';
    const recovered = 'Recovered';
    try {
      harness.emitPi({ type: 'turn_start' });
      harness.emitPi({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: partial }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: partial },
      });
      harness.tick(2);
      harness.runFrames();
      harness.emitPi({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: partial }],
          stopReason: 'error',
          errorMessage: '503 Service Unavailable',
        },
      });
      harness.emitPi({ type: 'agent_end', willRetry: true });
      harness.emitPi({ type: 'auto_retry_start', attempt: 1 });
      harness.emitPi({ type: 'turn_start' });
      harness.tick(2);
      harness.runFrames();
      const shownAtRetry = assistantRows(harness).find(row => !row.thinking)?.shown ?? '';
      expect(shownAtRetry).toBe(partial);
      harness.emitPi({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: recovered }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'vered' },
      });
      harness.emitPi({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: recovered }],
          stopReason: 'stop',
        },
      });
      harness.emitPi({ type: 'auto_retry_end', success: true, attempt: 1 });
      harness.emitPi({ type: 'agent_settled' });
      harness.settle();
      expect(
        harness.ipcEvents.some(
          event =>
            event.type === PiUiEventType.MessageUpdate &&
            (event as { metadata?: { streamReopen?: boolean } }).metadata?.streamReopen === true,
        ),
      ).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
