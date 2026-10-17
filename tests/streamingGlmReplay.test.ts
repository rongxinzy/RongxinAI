/**
 * Replays captured GLM Pi 1.x event traces through the production streaming
 * harness (PiRuntimeAdapter → forwarder → renderer pipeline).
 */
import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  PiUiEventType,
  createStreamingHarness,
  type PiUiEvent,
  type StreamingHarness,
} from './helpers/streamingPipelineHarness';
import { expectedFinalAssistantText, glmReplayEvents } from './helpers/loadGlmReplayFixture';
import { describe, expect, it } from 'vitest';

const jsonByteLength = (event: PiUiEvent): number =>
  Buffer.byteLength(JSON.stringify(event), 'utf8');

function assertPrefixOf(shown: string, expected: string, label: string): void {
  if (!expected.startsWith(shown)) {
    throw new Error(
      `${label}: displayed text is not a prefix of the final text (shown ${shown.length}, expected ${expected.length})`,
    );
  }
}

async function replayFixture(
  sessionId: string,
  fixtureName: string,
  run: (harness: StreamingHarness, finalAnswer: string) => void,
): Promise<void> {
  const events = glmReplayEvents(fixtureName);
  const expectedFinal = expectedFinalAssistantText(events);
  expect(expectedFinal.length).toBeGreaterThan(0);
  const harness = await createStreamingHarness({ sessionId, useSqliteStore: true });
  try {
    const answerIds = (): string[] => harness.answerMessageIds();
    harness.onFrame(() => {
      for (const messageId of answerIds()) {
        const shown = harness.displayed(messageId) ?? '';
        if (!shown) continue;
        assertPrefixOf(shown, expectedFinal, `frame ${harness.stats.delivered}`);
      }
    });
    for (const event of events) {
      harness.emitPi(event);
      harness.tick(1);
    }
    harness.settle();
    run(harness, expectedFinal);
  } finally {
    harness.dispose();
  }
}

describe('GLM Pi replay fixtures', () => {
  setupPiRuntimeAdapterSuite();

  it.each([
    ['glm-tool-text.jsonl', 'glm-replay-tool-text'],
    ['glm-fresh-pr1127.jsonl.gz', 'glm-replay-fresh'],
  ] as const)(
    'replay %s with prefix-safe frames and incremental IPC',
    async (fixture, sessionId) => {
      await replayFixture(sessionId, fixture, (harness, finalAnswer) => {
        for (const messageId of harness.answerMessageIds()) {
          expect(harness.displayed(messageId)).toBe(finalAnswer);
        }
        const dbAssistants = harness
          .dbMessages()
          .filter(message => message.type === 'assistant' && message.content.trim().length > 0);
        expect(dbAssistants.length).toBeGreaterThan(0);
        expect(dbAssistants.at(-1)?.content).toBe(finalAnswer);
        for (const message of harness.dbMessages()) {
          if (message.metadata?.isStreaming === true) {
            throw new Error(`DB message ${message.id} still marked streaming after settle`);
          }
        }
        const sessionEvents = harness.sessionIpcEvents();
        const contentPatches = sessionEvents.filter(
          event =>
            event.type === PiUiEventType.ContentPatch &&
            (event as { patch?: { metadata?: { isStreaming?: boolean } } }).patch?.metadata
              ?.isStreaming === true,
        );
        expect(contentPatches.length).toBeLessThanOrEqual(2);
        const ipcBytes = sessionEvents.reduce((total, event) => total + jsonByteLength(event), 0);
        expect(ipcBytes / Math.max(1, finalAnswer.length)).toBeLessThan(20);
      });
    },
    120_000,
  );

  it('preserves thinkingDurationMs after a thinking turn (glm-fresh)', async () => {
    await replayFixture('glm-replay-thinking-duration', 'glm-fresh-pr1127.jsonl.gz', harness => {
      const thinking = harness.currentMessages().find(message => message.metadata?.isThinking);
      expect(thinking?.metadata?.thinkingDurationMs).toEqual(expect.any(Number));
      const dbThinking = harness
        .dbMessages()
        .find(
          message =>
            message.type === 'assistant' &&
            typeof message.metadata?.thinkingDurationMs === 'number',
        );
      expect(dbThinking?.metadata?.thinkingDurationMs).toEqual(expect.any(Number));
    });
  }, 120_000);

  it('auto-retry keeps one bubble and growing text during the retry', async () => {
    const harness = await createStreamingHarness({
      sessionId: 'glm-replay-retry',
      useSqliteStore: true,
    });
    try {
      const scripted: unknown[] = [
        { type: 'turn_start' },
        {
          type: 'message_update',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Part' }] },
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Part' },
        },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Part' }],
            stopReason: 'error',
            errorMessage: '503 Service Unavailable',
          },
        },
        { type: 'agent_end' },
        { type: 'auto_retry_start', attempt: 1 },
        { type: 'turn_start' },
        {
          type: 'message_update',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Rec' }] },
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Reco' },
        },
        {
          type: 'message_update',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Recovered' }] },
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'vered' },
        },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Recovered' }],
            stopReason: 'stop',
          },
        },
        { type: 'agent_end' },
        { type: 'auto_retry_end', success: true, attempt: 1 },
        { type: 'agent_settled' },
      ];
      let lengthAfterError = 0;
      const lengthsDuringRetry: number[] = [];
      let seenRetry = false;
      for (const event of scripted) {
        if ((event as { type?: string }).type === 'auto_retry_start') seenRetry = true;
        harness.emitPi(event);
        harness.tick(2);
        harness.runFrames();
        if (
          seenRetry &&
          (event as { type?: string }).type === 'turn_start' &&
          harness.dbMessages().filter(message => message.type === 'assistant').length === 1
        ) {
          expect(
            harness.dbMessages().find(message => message.type === 'assistant')?.content,
          ).toBe('Part');
        }
        for (const messageId of harness.answerMessageIds()) {
          const length = (harness.displayed(messageId) ?? '').length;
          if (
            (event as { type?: string }).type === 'message_end' &&
            (event as { message?: { stopReason?: string } }).message?.stopReason === 'error'
          ) {
            lengthAfterError = length;
          } else if (seenRetry) {
            lengthsDuringRetry.push(length);
          }
        }
      }
      harness.settle();
      expect(harness.answerMessageIds()).toHaveLength(1);
      const messageId = harness.answerMessageIds()[0]!;
      const finalContent = harness.message(messageId)?.content ?? '';
      expect(finalContent).toBe('Recovered');
      expect(harness.displayed(messageId)).toBe(finalContent);
      expect(Math.max(...lengthsDuringRetry)).toBeGreaterThan(lengthAfterError);
      const dbAssistants = harness.dbMessages().filter(message => message.type === 'assistant');
      expect(dbAssistants).toHaveLength(1);
      expect(dbAssistants[0]?.content).toBe('Recovered');
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
  }, 30_000);
});
