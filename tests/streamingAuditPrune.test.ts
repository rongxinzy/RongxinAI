import {
  createTestPiRuntime,
  setupPiRuntimeAdapterSuite,
} from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { createHarnessCoworkStore, ensureHarnessCoworkSession } from './helpers/harnessCoworkStore';
import { createStreamingHarness, PiTurnBuilder } from './helpers/streamingPipelineHarness';
import { describe, expect, it } from 'vitest';

describe('streaming audit finalized id pruning', () => {
  setupPiRuntimeAdapterSuite();

  it('prunes finalizedMessageIds per session after settle and session teardown', async () => {
    const { store, cleanup } = createHarnessCoworkStore();
    const runtime = createTestPiRuntime({ coworkStore: store });
    const { finalizedMessageIds } = runtime.transcript as unknown as {
      finalizedMessageIds: Set<string>;
    };

    try {
      for (let index = 0; index < 3; index += 1) {
        const sessionId = `prune-${index}`;
        ensureHarnessCoworkSession(store, sessionId, 'work');
        const harness = await createStreamingHarness({ sessionId, runtime });
        const builder = new PiTurnBuilder();
        try {
          for (const event of [
            builder.agentStart(),
            builder.turnStart(),
            builder.messageStart(),
            builder.beginThinkingPart(0),
            builder.appendThinking(0, 'hm'),
            builder.endThinkingPart(0),
            builder.beginTextPart(1),
            builder.appendText(1, 'hello there'),
            builder.messageEnd(),
            builder.turnEnd(),
            builder.agentEnd(),
          ]) {
            harness.emitPi(event);
            harness.tick(5);
            harness.runFrames();
          }
          expect(finalizedMessageIds.size).toBe(2);
          if (index === 2) runtime.stopSession(sessionId);
          else harness.emitPi(builder.agentSettled());
          harness.settle();
          await Promise.resolve();
          harness.settle();
          expect(finalizedMessageIds.size).toBe(0);
        } finally {
          harness.dispose();
        }
      }
    } finally {
      runtime.stopAllSessions();
      cleanup();
    }
  });
});
