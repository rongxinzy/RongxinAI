import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  adapter,
  setupPiRuntimeAdapterSuite,
} from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { PiTurnBuilder } from './helpers/streamingPipelineHarness';
import { createAuditHarness } from './helpers/streamingAuditHelpers';
import { describe, expect, it } from 'vitest';

describe('streaming audit finalized id pruning', () => {
  setupPiRuntimeAdapterSuite();

  it('prunes finalizedMessageIds per session after settle and session teardown', async () => {
    const finalizedSize = (): number =>
      (adapter.transcript as unknown as { finalizedMessageIds: Set<string> }).finalizedMessageIds
        .size;

    for (let index = 0; index < 3; index += 1) {
      const sessionId = `prune-${index}`;
      const { harness, cleanup } = await createAuditHarness(sessionId);
      const builder = new PiTurnBuilder();
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
        builder.agentSettled(),
      ]) {
        harness.emitPi(event);
        harness.tick(5);
        harness.runFrames();
      }
      harness.settle();
      await Promise.resolve();
      harness.settle();
      expect(finalizedSize()).toBe(0);
      harness.dispose();
      cleanup();
    }
  });
});
