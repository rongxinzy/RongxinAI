/**
 * Cowork streaming consistency tests — recovery scenarios C5..C7 (IPC gaps +
 * resync, late attach, duplicate/reordered deliveries, per-frame invariants).
 * Scenarios C1..C4 live in `streamingConsistency.test.ts`.
 *
 * Same ground rules: drive the REAL production chain end to end (mock Pi SDK →
 * PiRuntimeAdapter → forwarder → intercepted UiEvent IPC (lossy/reordered on
 * purpose) → renderer pipeline → LiveTextStore → real coworkReducer) and assert
 * only observable behavior. **禁止**在测试内重新拼装链路或断言源码文本。
 *
 * Import order matters: the Pi SDK mock module must be evaluated first.
 */
import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  PiUiEventType,
  buildCorpus,
  buildInterleavedThinkingTurn,
  buildTextTurn,
  createStreamingHarness,
  mulberry32,
  type BuiltTurn,
  type DeliveryControls,
  type PiStreamEvent,
  type PiUiEvent,
  type StreamingHarness,
} from './helpers/streamingPipelineHarness';
import { describe, expect, it } from 'vitest';

// ─── shared helpers ──────────────────────────────────────────────────────────

type Random = () => number;

/** Resolve the first message id or fail with context (no `!` assertions). */
function requireFirstId(ids: readonly string[], label: string): string {
  const id = ids[0];
  if (id === undefined) {
    throw new Error(`${label}: expected at least one matching Cowork message in Redux`);
  }
  return id;
}

/** Streaming invariant: `shown` must be a prefix of `expected`. */
function assertPrefixOf(shown: string, expected: string, label: string): void {
  if (!expected.startsWith(shown)) {
    throw new Error(
      `${label}: displayed text is not a prefix of the final text ` +
        `(shown ${shown.length} chars, expected ${expected.length} chars); ` +
        `shown head=${JSON.stringify(shown.slice(0, 60))}`,
    );
  }
}

/** Create a harness for `sessionId` and ALWAYS dispose it (shared adapter). */
async function withStreamingHarness(
  sessionId: string,
  run: (harness: StreamingHarness) => void,
): Promise<void> {
  const harness = await createStreamingHarness({ sessionId });
  try {
    run(harness);
  } finally {
    harness.dispose();
  }
}

/** Emit events in randomly sized groups, one coalescer window per group. */
function emitGrouped(
  harness: StreamingHarness,
  events: readonly PiStreamEvent[],
  random: Random,
  minGroup: number,
  maxGroup: number,
): void {
  let offset = 0;
  while (offset < events.length) {
    const size = minGroup + Math.floor(random() * (maxGroup - minGroup + 1));
    harness.emitBatch(events.slice(offset, offset + size), 16);
    offset += size;
  }
}

/** True when the IPC event carries an assistant text-delta chunk. */
function isTextDeltaEvent(event: PiUiEvent): boolean {
  if (event.type !== PiUiEventType.StreamPart) return false;
  return (event as { chunk?: { type?: unknown } }).chunk?.type === 'text-delta';
}

interface TurnPlan {
  readonly turn: BuiltTurn;
  readonly hasThinking: boolean;
}

/**
 * Deterministic per-seed turn, identical to the one used by C1 in
 * `streamingConsistency.test.ts` (same seed → same turn) so C7 covers exactly
 * the same corpus of conversations with per-frame invariants.
 */
function buildFinalStateTurn(seed: number): TurnPlan {
  const random = mulberry32(0x5eed_c100 + seed * 7919);
  const hasThinking = random() < 0.4;
  const length = 150 + Math.floor(random() * 450);
  if (hasThinking) {
    return {
      hasThinking: true,
      turn: buildInterleavedThinkingTurn({
        textBefore: buildCorpus(Math.max(30, Math.floor(length * 0.35)), random),
        thinking: buildCorpus(80 + Math.floor(random() * 120), random),
        textAfter: buildCorpus(Math.max(30, Math.floor(length * 0.4)), random),
        random,
        minDelta: 5,
        maxDelta: 28,
        emitStartEnd: true,
      }),
    };
  }
  return {
    hasThinking: false,
    turn: buildTextTurn({
      text: buildCorpus(length, random),
      random,
      minDelta: 5,
      maxDelta: 28,
      emitStartEnd: true,
    }),
  };
}

// ─── scenarios ────────────────────────────────────────────────────────────────

describe('Cowork streaming consistency C5–C7 (recovery through the real pipeline)', () => {
  setupPiRuntimeAdapterSuite();

  it(
    'C5/B7: a mid-stream IPC gap recovers via resync and stays prefix-exact (80 seeds)',
    async () => {
      const seedCount = 80;
      let aggregateGapDetections = 0;
      for (let seed = 0; seed < seedCount; seed += 1) {
        const random = mulberry32(0x5eed_c5a0 + seed * 37);
        const turn = buildTextTurn({
          text: buildCorpus(900 + Math.floor(random() * 500), random),
          random,
          minDelta: 8,
          maxDelta: 16,
          emitStartEnd: true,
        });
        // Drop a contiguous run of 3..20 IPC events, armed at a text-delta
        // once `warmup` events were delivered (guarantees a CONTENT gap).
        const warmup = 3 + Math.floor(random() * 6);
        const runLength = 3 + Math.floor(random() * 18);
        let deliveredCount = 0;
        let droppedRun = 0;
        let dropRemaining = 0;
        let armed = false;
        let resyncPending = false;
        let gapPassed = false;
        let lastSeenResyncRequests = 0;

        await withStreamingHarness(`seed-c5a-${seed}`, harness => {
          lastSeenResyncRequests = harness.stats.resyncRequests;
          const controls: DeliveryControls = {
            dropWhen: (_index: number, event: PiUiEvent): boolean => {
              if (dropRemaining > 0) {
                dropRemaining -= 1;
                droppedRun += 1;
                return true;
              }
              if (!armed && deliveredCount >= warmup && isTextDeltaEvent(event)) {
                armed = true;
                dropRemaining = runLength - 1;
                droppedRun += 1;
                return true;
              }
              return false;
            },
            onDelivered: (): void => {
              deliveredCount += 1;
              if (resyncPending) {
                // This delivery followed a resync request — post-fix it IS
                // the resync snapshot arriving.
                gapPassed = true;
                resyncPending = false;
              }
              if (harness.stats.resyncRequests > lastSeenResyncRequests) {
                lastSeenResyncRequests = harness.stats.resyncRequests;
                resyncPending = true;
              }
            },
          };
          harness.setDeliveryControls(controls);

          harness.onFrame(() => {
            if (!gapPassed) return;
            const answerId = harness.answerMessageIds()[0];
            if (answerId === undefined) return;
            const shown = harness.displayed(answerId);
            if (shown === undefined) return;
            assertPrefixOf(shown, turn.finalText, `C5a seed ${seed} post-resync frame`);
          });

          for (const event of turn.streamEvents) {
            harness.emitPi(event);
            harness.tick(16);
            harness.runFrames();
          }
          harness.emitBatch(turn.endEvents, 16);
          harness.settle();

          // Statistics: the gap branch really executed for this seed.
          expect(armed, `C5a seed ${seed}: gap armed`).toBe(true);
          expect(droppedRun, `C5a seed ${seed}: dropped run length`).toBe(runLength);
          expect(gapPassed, `C5a seed ${seed}: delivery resumed after the gap`).toBe(true);
          const gapDetections = harness.stats.sequenceGaps + harness.stats.contentGaps;
          expect(gapDetections, `C5a seed ${seed}: renderer detected the gap`).toBeGreaterThan(0);
          aggregateGapDetections += gapDetections;

          const answerId = requireFirstId(
            harness.answerMessageIds(),
            `C5a seed ${seed}: answer message`,
          );
          expect(harness.displayed(answerId), `C5a seed ${seed}: final displayed`).toBe(
            turn.finalText,
          );
          const answer = harness.message(answerId);
          expect(answer?.content, `C5a seed ${seed}: final content`).toBe(turn.finalText);
          expect(answer?.metadata?.isStreaming, `C5a seed ${seed}: isStreaming`).toBe(false);
        });
      }
      expect(aggregateGapDetections, 'C5a: aggregate gap detections').toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    'C5/B7: late attach (first N IPC events never delivered) rebuilds the full prefix (80 seeds)',
    async () => {
      const seedCount = 80;
      let aggregateGapDetections = 0;
      for (let seed = 0; seed < seedCount; seed += 1) {
        const random = mulberry32(0x5eed_c5b0 + seed * 41);
        const turn = buildTextTurn({
          text: buildCorpus(700 + Math.floor(random() * 300), random),
          random,
          minDelta: 8,
          maxDelta: 16,
          emitStartEnd: true,
        });
        // New window attaching mid-stream: the first 4..15 IPC events are
        // never delivered to the renderer pipeline.
        const skipCount = 4 + Math.floor(random() * 12);
        let deliveriesAfterSkip = 0;
        let resyncPending = false;
        let gapPassed = false;
        let lastSeenResyncRequests = 0;

        await withStreamingHarness(`seed-c5b-${seed}`, harness => {
          lastSeenResyncRequests = harness.stats.resyncRequests;
          const controls: DeliveryControls = {
            dropWhen: (index: number): boolean => index < skipCount,
            onDelivered: (): void => {
              deliveriesAfterSkip += 1;
              if (resyncPending) {
                gapPassed = true;
                resyncPending = false;
              }
              if (harness.stats.resyncRequests > lastSeenResyncRequests) {
                lastSeenResyncRequests = harness.stats.resyncRequests;
                resyncPending = true;
              }
            },
          };
          harness.setDeliveryControls(controls);

          harness.onFrame(() => {
            if (!gapPassed) return;
            const answerId = harness.answerMessageIds()[0];
            if (answerId === undefined) return;
            const shown = harness.displayed(answerId);
            if (shown === undefined) return;
            assertPrefixOf(shown, turn.finalText, `C5b seed ${seed} post-attach frame`);
          });

          for (const event of turn.streamEvents) {
            harness.emitPi(event);
            harness.tick(16);
            harness.runFrames();
          }
          harness.emitBatch(turn.endEvents, 16);
          harness.settle();

          expect(deliveriesAfterSkip, `C5b seed ${seed}: deliveries after attach`).toBeGreaterThan(
            0,
          );
          expect(gapPassed, `C5b seed ${seed}: attach recovery snapshot observed`).toBe(true);
          const gapDetections = harness.stats.sequenceGaps + harness.stats.contentGaps;
          expect(gapDetections, `C5b seed ${seed}: renderer detected the attach gap`).toBeGreaterThan(
            0,
          );
          aggregateGapDetections += gapDetections;

          const answerId = requireFirstId(
            harness.answerMessageIds(),
            `C5b seed ${seed}: answer message`,
          );
          expect(harness.displayed(answerId), `C5b seed ${seed}: final displayed`).toBe(
            turn.finalText,
          );
          const answer = harness.message(answerId);
          expect(answer?.content, `C5b seed ${seed}: final content`).toBe(turn.finalText);
          expect(answer?.metadata?.isStreaming, `C5b seed ${seed}: isStreaming`).toBe(false);
        });
      }
      expect(aggregateGapDetections, 'C5b: aggregate gap detections').toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    'C6: duplicated and adjacent-swapped IPC deliveries keep every frame consistent (80 seeds)',
    async () => {
      const seedCount = 80;
      let totalSwapped = 0;
      let totalDuplicated = 0;
      let aggregateGapDetections = 0;
      for (let seed = 0; seed < seedCount; seed += 1) {
        const random = mulberry32(0x5eed_c600 + seed * 53);
        const turn = buildTextTurn({
          text: buildCorpus(500 + Math.floor(random() * 300), random),
          random,
          minDelta: 8,
          maxDelta: 16,
          emitStartEnd: true,
        });

        await withStreamingHarness(`seed-c6-${seed}`, harness => {
          const controls: DeliveryControls = {
            // 5% of deliveries are duplicated, 5% swapped with the next one.
            duplicateWhen: (): boolean => random() < 0.05,
            swapWithNextWhen: (): boolean => random() < 0.05,
          };
          harness.setDeliveryControls(controls);

          harness.onFrame(() => {
            const answerId = harness.answerMessageIds()[0];
            if (answerId === undefined) return;
            const shown = harness.displayed(answerId);
            if (shown === undefined) return;
            assertPrefixOf(shown, turn.finalText, `C6 seed ${seed} frame`);
          });

          for (const event of turn.streamEvents) {
            harness.emitPi(event);
            harness.tick(16);
            harness.runFrames();
          }
          harness.emitBatch(turn.endEvents, 16);
          harness.settle();

          totalSwapped += harness.stats.swapped;
          totalDuplicated += harness.stats.duplicated;
          aggregateGapDetections += harness.stats.sequenceGaps + harness.stats.contentGaps;

          const answerId = requireFirstId(
            harness.answerMessageIds(),
            `C6 seed ${seed}: answer message`,
          );
          expect(harness.displayed(answerId), `C6 seed ${seed}: final displayed`).toBe(
            turn.finalText,
          );
          const answer = harness.message(answerId);
          expect(answer?.content, `C6 seed ${seed}: final content`).toBe(turn.finalText);
          expect(answer?.metadata?.isStreaming, `C6 seed ${seed}: isStreaming`).toBe(false);
        });
      }
      // Statistics: both anomaly branches actually exercised.
      expect(totalSwapped, 'C6: adjacent swaps exercised').toBeGreaterThan(0);
      expect(totalDuplicated, 'C6: duplicate deliveries exercised').toBeGreaterThan(0);
      expect(aggregateGapDetections, 'C6: sequence gaps from swaps observed').toBeGreaterThan(0);
    },
    150_000,
  );

  it(
    'C7: every intermediate frame renders a prefix of the final answer text (120 seeds)',
    async () => {
      const seedCount = 120;
      let aggregateFramesChecked = 0;
      for (let seed = 0; seed < seedCount; seed += 1) {
        await withStreamingHarness(`seed-c7-${seed}`, harness => {
          const plan = buildFinalStateTurn(seed);
          const { turn } = plan;

          let framesChecked = 0;
          harness.onFrame(() => {
            const answerId = harness.answerMessageIds()[0];
            if (answerId !== undefined) {
              const shown = harness.displayed(answerId);
              if (shown !== undefined) {
                framesChecked += 1;
                assertPrefixOf(shown, turn.finalText, `C7 seed ${seed} answer frame`);
              }
            }
            if (plan.hasThinking) {
              const thinkingId = harness.thinkingMessageIds()[0];
              if (thinkingId !== undefined) {
                const shown = harness.displayed(thinkingId);
                if (shown !== undefined) {
                  assertPrefixOf(shown, turn.finalThinking, `C7 seed ${seed} thinking frame`);
                }
              }
            }
          });

          // Small groups → many frames across the whole stream.
          emitGrouped(harness, turn.streamEvents, mulberry32(0x5eed_c7f0 + seed), 1, 3);
          harness.emitBatch(turn.endEvents, 16);
          harness.settle();

          const answerId = requireFirstId(
            harness.answerMessageIds(),
            `C7 seed ${seed}: answer message`,
          );
          expect(harness.displayed(answerId), `C7 seed ${seed}: final displayed`).toBe(
            turn.finalText,
          );
          expect(framesChecked, `C7 seed ${seed}: frame coverage`).toBeGreaterThan(0);
          aggregateFramesChecked += framesChecked;
        });
      }
      expect(aggregateFramesChecked, 'C7: aggregate per-frame assertions').toBeGreaterThan(0);
    },
    180_000,
  );
});
