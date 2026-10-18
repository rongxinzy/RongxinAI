/**
 * End-to-end: main-process messageRemoved → forwarder → renderer pipeline.
 */
import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  adapter,
  setupPiRuntimeAdapterSuite,
} from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { PiUiEventType } from '../src/shared/cowork/piUiEvent';
import { createStreamingHarness } from './helpers/streamingPipelineHarness';
import { describe, expect, it } from 'vitest';

describe('streaming message removed IPC', () => {
  setupPiRuntimeAdapterSuite();

  it('removes the Redux row without sequence gap or resync', async () => {
    const sessionId = 'streaming-message-removed';
    const harness = await createStreamingHarness({ sessionId });
    try {
      harness.emitPi({ type: 'turn_start' });
      harness.emitPi({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Visible' }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Visible' },
      });
      harness.tick(20);
      harness.runFrames();
      const messageId = harness.answerMessageIds()[0];
      expect(messageId).toBeDefined();
      expect(harness.message(messageId)?.content).toBe('Visible');

      adapter.emit('messageRemoved', sessionId, messageId);
      harness.settle();

      expect(harness.currentMessages().some(message => message.id === messageId)).toBe(false);
      expect(
        harness.sessionIpcEvents().some(event => event.type === PiUiEventType.MessageRemoved),
      ).toBe(true);
      expect(harness.stats.sequenceGaps).toBe(0);
      expect(harness.stats.resyncRequests).toBe(0);
    } finally {
      harness.dispose();
    }
  });
});
