/**
 * Cowork streaming consistency tests — scenarios C1..C4 (terminal Redux state,
 * non-prefix rewrite, interleaved part ordering, 2M truncation).
 * Recovery scenarios C5..C7 live in `streamingConsistencyRecovery.test.ts`.
 *
 * Every scenario drives the REAL production chain end to end:
 *   mock Pi SDK → PiRuntimeAdapter → forwarder (coalescer → sequencer →
 *   webContents.send) → intercepted UiEvent IPC → renderer pipeline
 *   (sequence tracker → rAF batchers) → LiveTextStore → real coworkReducer.
 * Tests only feed Pi events at one edge and assert observable behavior at the
 * renderer/IPC edges. **禁止**在测试内重新拼装链路、扫描源码文本或放宽为“近似”断言。
 *
 * Import order matters: the Pi SDK mock module must be evaluated before any
 * module that transitively loads Pi SDK mocks.
 */
import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  PiTurnBuilder,
  buildCorpus,
  buildInterleavedThinkingTurn,
  buildTextTurn,
  createStreamingHarness,
  mulberry32,
  splitIntoDeltas,
  type BuiltTurn,
  type PiStreamEvent,
  type StreamingHarness,
} from './helpers/streamingPipelineHarness';
import { PiUiEventType } from '../src/shared/cowork/piUiEvent';
import { CoworkRunPolicy } from '../src/shared/cowork/runState';
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

/**
 * Create a harness for `sessionId` and ALWAYS dispose it — even when the test
 * body fails mid-flight — because the suite adapter and the fake window list
 * are shared module state.
 */
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

/** Length of a text-delta chunk payload ('delta' per ai@6, 'text' fallback). */
function textDeltaLength(chunk: unknown): number {
  const record = chunk as { delta?: unknown; text?: unknown };
  if (typeof record.delta === 'string') return record.delta.length;
  if (typeof record.text === 'string') return record.text.length;
  return 0;
}

// ─── deterministic turn builders ─────────────────────────────────────────────

interface TurnPlan {
  readonly turn: BuiltTurn;
  readonly hasThinking: boolean;
}

/**
 * Deterministic per-seed turn shared by C1 (terminal state) and C7 (per-frame
 * prefix invariants): the same seed always yields the same turn.
 * emitStartEnd must be true — real AgentSession always sends part-start events.
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

/**
 * deltas(initial) → delta-less non-prefix rewrite(rewritten) → deltas(continuation).
 * Built directly on PiTurnBuilder (parts must be registered with text_start
 * before deltas, exactly like the embedded AgentSession).
 */
function buildRewriteTurn(
  initialText: string,
  rewrittenText: string,
  continuation: string,
  random: Random,
): BuiltTurn {
  const builder = new PiTurnBuilder(random);
  const streamEvents: PiStreamEvent[] = [
    builder.agentStart(),
    builder.turnStart(),
    builder.messageStart(),
    builder.beginTextPart(0),
  ];
  for (const delta of splitIntoDeltas(initialText, 3, 9, random)) {
    streamEvents.push(builder.appendText(0, delta));
  }
  const rewriteEventIndex = streamEvents.length;
  streamEvents.push(builder.rewriteText(rewrittenText));
  for (const delta of splitIntoDeltas(continuation, 3, 9, random)) {
    streamEvents.push(builder.appendText(0, delta));
  }
  streamEvents.push(builder.endTextPart(0));
  const endEvents: PiStreamEvent[] = [
    builder.messageEnd('stop'),
    builder.turnEnd(),
    builder.agentEnd(),
    builder.agentSettled(),
  ];
  return {
    events: [...streamEvents, ...endEvents],
    streamEvents,
    endEvents,
    finalText: builder.textSoFar(),
    finalThinking: builder.thinkingSoFar(),
    rewriteEventIndex,
  };
}

// ─── scenarios ────────────────────────────────────────────────────────────────

describe('Cowork streaming consistency C1–C4 (real end-to-end pipeline)', () => {
  setupPiRuntimeAdapterSuite();

  it('C1/B2: terminal answer/thinking content and isStreaming=false reach renderer Redux (120 seeds)', async () => {
    const seedCount = 120;
    for (let seed = 0; seed < seedCount; seed += 1) {
      await withStreamingHarness(`seed-c1-${seed}`, harness => {
        const plan = buildFinalStateTurn(seed);
        const { turn } = plan;
        // Grouped batches exercise the coalescer (several deltas per window).
        emitGrouped(harness, turn.streamEvents, mulberry32(0x5eed_c1f0 + seed), 3, 9);
        harness.emitBatch(turn.endEvents, 16);
        harness.settle();

        const answerId = requireFirstId(
          harness.answerMessageIds(),
          `C1 seed ${seed}: answer message`,
        );
        const answer = harness.message(answerId);
        expect(answer?.content, `C1 seed ${seed}: final answer content`).toBe(turn.finalText);
        expect(answer?.metadata?.isStreaming, `C1 seed ${seed}: answer isStreaming`).toBe(false);

        if (plan.hasThinking) {
          const thinkingId = requireFirstId(
            harness.thinkingMessageIds(),
            `C1 seed ${seed}: thinking message`,
          );
          const thinking = harness.message(thinkingId);
          expect(thinking?.content, `C1 seed ${seed}: final thinking content`).toBe(
            turn.finalThinking,
          );
          expect(thinking?.metadata?.isStreaming, `C1 seed ${seed}: thinking isStreaming`).toBe(
            false,
          );
        }
      });
    }
  }, 120_000);

  it("C2/B5: a non-prefix rewrite keeps the rewritten text live ('hello wrld' → 'hello world' → '!')", async () => {
    await withStreamingHarness('seed-c2-rewrite', harness => {
      const turn = buildRewriteTurn('hello wrld', 'hello world', '!', mulberry32(0x5eed_c2d0));
      emitGrouped(harness, turn.streamEvents, mulberry32(0x5eed_c2d1), 2, 4);
      harness.runFrames();

      const answerId = requireFirstId(harness.answerMessageIds(), 'C2 fixed: answer message');
      // BEFORE message_end: rewrite + trailing delta must both be live. This
      // is exactly what B5 breaks (snapshot wiped by the next delta).
      expect(harness.displayed(answerId), 'C2 fixed: displayed before message_end').toBe(
        'hello world!',
      );

      harness.emitBatch(turn.endEvents, 16);
      harness.settle();
      expect(harness.displayed(answerId), 'C2 fixed: displayed after settle').toBe('hello world!');
      const answer = harness.message(answerId);
      expect(answer?.content, 'C2 fixed: final content').toBe('hello world!');
      expect(answer?.metadata?.isStreaming, 'C2 fixed: isStreaming').toBe(false);
    });
  }, 15_000);

  it('C2/B5: randomized rewrite positions stay consistent (60 seeds)', async () => {
    const seedCount = 60;
    for (let seed = 0; seed < seedCount; seed += 1) {
      await withStreamingHarness(`seed-c2r-${seed}`, harness => {
        const random = mulberry32(0x5eed_c250 + seed * 131);
        const initialText = buildCorpus(40 + Math.floor(random() * 260), random);
        // '#' is never a corpus first character, so neither text can be a
        // prefix of the other → the rewrite is guaranteed non-prefix.
        const rewrittenText = `#${buildCorpus(80 + Math.floor(random() * 200), random)}`;
        const continuation = buildCorpus(10 + Math.floor(random() * 190), random);
        const turn = buildRewriteTurn(initialText, rewrittenText, continuation, random);
        const rewriteIndex = turn.rewriteEventIndex ?? 0;

        // Phase 1 — everything up to and including the rewrite.
        emitGrouped(harness, turn.streamEvents.slice(0, rewriteIndex + 1), random, 3, 8);
        const answerId = requireFirstId(
          harness.answerMessageIds(),
          `C2r seed ${seed}: answer message`,
        );
        expect(
          harness.displayed(answerId),
          `C2r seed ${seed}: displayed right after the rewrite`,
        ).toBe(rewrittenText);

        // Phase 2 — continuation deltas; every frame must stay a prefix.
        let framesChecked = 0;
        harness.onFrame(() => {
          const shown = harness.displayed(answerId);
          if (shown === undefined) return;
          framesChecked += 1;
          assertPrefixOf(shown, turn.finalText, `C2r seed ${seed} frame`);
        });
        emitGrouped(harness, turn.streamEvents.slice(rewriteIndex + 1), random, 3, 8);

        expect(harness.displayed(answerId), `C2r seed ${seed}: displayed before message_end`).toBe(
          turn.finalText,
        );
        expect(framesChecked, `C2r seed ${seed}: frame coverage`).toBeGreaterThan(0);

        harness.emitBatch(turn.endEvents, 16);
        harness.settle();
        const answer = harness.message(answerId);
        expect(answer?.content, `C2r seed ${seed}: final content`).toBe(turn.finalText);
        expect(answer?.metadata?.isStreaming, `C2r seed ${seed}: isStreaming`).toBe(false);
      });
    }
  }, 90_000);

  it('C3/B6: interleaved text→thinking→text parts keep answer text ordered (200 iterations)', async () => {
    const iterations = 200;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await withStreamingHarness(`seed-c3-${iteration}`, harness => {
        const random = mulberry32(0x5eed_c300 + iteration * 17);
        const turn = buildInterleavedThinkingTurn({
          textBefore: buildCorpus(30 + Math.floor(random() * 60), random),
          thinking: buildCorpus(20 + Math.floor(random() * 50), random),
          textAfter: buildCorpus(30 + Math.floor(random() * 60), random),
          random,
          minDelta: 4,
          maxDelta: 18,
          emitStartEnd: true,
        });

        // One Pi event per coalescer window: every delta lands in its own
        // frame, so part-id ordering bugs show up as non-prefix frames.
        let framesChecked = 0;
        harness.onFrame(() => {
          const answerId = harness.answerMessageIds()[0];
          if (answerId !== undefined) {
            const shown = harness.displayed(answerId);
            if (shown !== undefined) {
              framesChecked += 1;
              assertPrefixOf(shown, turn.finalText, `C3 iter ${iteration} answer frame`);
            }
          }
          const thinkingId = harness.thinkingMessageIds()[0];
          if (thinkingId !== undefined) {
            const shown = harness.displayed(thinkingId);
            if (shown !== undefined) {
              assertPrefixOf(shown, turn.finalThinking, `C3 iter ${iteration} thinking frame`);
            }
          }
        });

        for (const event of turn.streamEvents) {
          harness.emitPi(event);
          harness.tick(16);
          harness.runFrames();
        }

        const answerId = requireFirstId(
          harness.answerMessageIds(),
          `C3 iter ${iteration}: answer message`,
        );
        expect(
          harness.displayed(answerId),
          `C3 iter ${iteration}: displayed before message_end`,
        ).toBe(turn.finalText);
        const thinkingId = requireFirstId(
          harness.thinkingMessageIds(),
          `C3 iter ${iteration}: thinking message`,
        );
        expect(harness.displayed(thinkingId), `C3 iter ${iteration}: thinking before end`).toBe(
          turn.finalThinking,
        );

        harness.emitBatch(turn.endEvents, 16);
        harness.settle();
        const answer = harness.message(answerId);
        expect(answer?.content, `C3 iter ${iteration}: final content`).toBe(turn.finalText);
        expect(answer?.metadata?.isStreaming, `C3 iter ${iteration}: isStreaming`).toBe(false);
        const thinking = harness.message(thinkingId);
        expect(thinking?.content, `C3 iter ${iteration}: final thinking`).toBe(turn.finalThinking);
        expect(framesChecked, `C3 iter ${iteration}: frame coverage`).toBeGreaterThan(0);
      });
    }
  }, 240_000);

  it('C4/B4: content truncates at CoworkRunPolicy.MaximumContentCharacters (2M cap)', async () => {
    await withStreamingHarness('seed-c4-truncate', harness => {
      const random = mulberry32(0x5eed_c400);
      const max = CoworkRunPolicy.MaximumContentCharacters;
      const overflow = 5_000;
      const totalLength = max + overflow;
      expect(totalLength, 'C4: streamed body must exceed the cap').toBeGreaterThan(max);

      // BMP-only filler: code points === UTF-16 units, so the cap is
      // unambiguous regardless of how production counts "characters".
      const fillerPiece = '流式streaming一致性测试тестテスト한국어 truncate-2M 0123456789 ';
      const filler = fillerPiece.repeat(200);
      const body = filler.repeat(Math.ceil(totalLength / filler.length)).slice(0, totalLength);
      expect(body.length).toBe(totalLength);

      // Big deltas keep the event count low (this is a policy test, not a
      // batching test). String building below happens outside any timing.
      const builder = new PiTurnBuilder(random);
      const streamEvents: PiStreamEvent[] = [
        builder.agentStart(),
        builder.turnStart(),
        builder.messageStart(),
        builder.beginTextPart(0),
      ];
      let sent = 0;
      while (sent < totalLength) {
        const size = Math.min(60_000 + Math.floor(random() * 60_000), totalLength - sent);
        streamEvents.push(builder.appendText(0, body.slice(sent, sent + size)));
        sent += size;
      }
      streamEvents.push(builder.endTextPart(0));
      const expectedFinal = builder.textSoFar().slice(0, max);

      let framesChecked = 0;
      harness.onFrame(() => {
        const answerId = harness.answerMessageIds()[0];
        if (answerId === undefined) return;
        const shown = harness.displayed(answerId);
        if (shown === undefined) return;
        framesChecked += 1;
        if (shown.length > max) {
          throw new Error(
            `C4: displayed length ${shown.length} exceeded the cap ${max} mid-stream`,
          );
        }
      });

      for (const event of streamEvents) {
        harness.emitPi(event);
        harness.tick(16);
        harness.runFrames();
      }
      harness.emitBatch(
        [builder.messageEnd('stop'), builder.turnEnd(), builder.agentEnd(), builder.agentSettled()],
        16,
      );
      harness.settle();

      const answerId = requireFirstId(harness.answerMessageIds(), 'C4: answer message');
      const deltaChars = harness.textDeltaIpcEvents(answerId).reduce((sum, event) => {
        return sum + textDeltaLength((event as { chunk?: unknown }).chunk);
      }, 0);
      // No text-delta bytes may cross the cap...
      expect(deltaChars, 'C4: text-delta characters over IPC').toBeLessThanOrEqual(max);
      // ...and truncation must engage AT the cap, not early.
      expect(deltaChars, 'C4: truncation engaged near the cap').toBeGreaterThan(max - 130_000);

      const answer = harness.message(answerId);
      expect(answer?.content?.length, 'C4: final content length').toBe(max);
      // Compare without a multi-megabyte diff on failure.
      const content = answer?.content ?? '';
      if (content !== expectedFinal) {
        let firstDiff = 0;
        while (firstDiff < max && content[firstDiff] === expectedFinal[firstDiff]) firstDiff += 1;
        throw new Error(`C4: final content differs from the truncated expectation at ${firstDiff}`);
      }
      expect(answer?.metadata?.contentTruncated, 'C4: contentTruncated metadata').toBe(true);
      expect(answer?.metadata?.isStreaming, 'C4: isStreaming').toBe(false);
      expect(framesChecked, 'C4: mid-stream frame coverage').toBeGreaterThan(0);
    });
  }, 60_000);

  it('C8/B2: delta-less cumulative snapshots stream incrementally, never as snapshots (20 seeds)', async () => {
    const seedCount = 20;
    for (let seed = 0; seed < seedCount; seed += 1) {
      const sessionId = `seed-c8-${seed}`;
      await withStreamingHarness(sessionId, harness => {
        const random = mulberry32(0x5eed_c800 + seed * 101);
        const builder = new PiTurnBuilder(random);
        const finalText = buildCorpus(420 + Math.floor(random() * 580), random);
        const updates = 30 + Math.floor(random() * 31); // 30–60 snapshots
        // Cumulative prefixes: strictly growing, each one a prefix of the
        // next and of the final text.
        const prefixes: string[] = [];
        for (let i = 1; i <= updates; i += 1) {
          prefixes.push(finalText.slice(0, Math.floor((finalText.length * i) / updates)));
        }
        const streamEvents: PiStreamEvent[] = [
          builder.agentStart(),
          builder.turnStart(),
          builder.messageStart(),
          // Establish the (empty) text part first; its text_start may be
          // emitted. All content below arrives WITHOUT assistantMessageEvent.
          builder.beginTextPart(0),
        ];
        for (const prefix of prefixes) {
          // rewriteText emits a message_update with NO assistantMessageEvent —
          // exactly the delta-less cumulative snapshot shape B2 must handle.
          streamEvents.push(builder.rewriteText(prefix));
        }
        const endEvents: PiStreamEvent[] = [
          builder.messageEnd('stop'),
          builder.turnEnd(),
          builder.agentEnd(),
          builder.agentSettled(),
        ];

        // (b) every rendered frame must stay a prefix of the final text.
        let framesChecked = 0;
        harness.onFrame(() => {
          const answerId = harness.answerMessageIds()[0];
          if (answerId === undefined) return;
          const shown = harness.displayed(answerId);
          if (shown === undefined) return;
          framesChecked += 1;
          assertPrefixOf(shown, finalText, `C8 seed ${seed} frame`);
        });

        // First batch: scaffolding + the first cumulative snapshots. Live
        // text must already be non-empty — snapshots may not sit idle until
        // message_end.
        harness.emitBatch(streamEvents.slice(0, 6), 16);
        harness.runFrames();
        const answerId = requireFirstId(
          harness.answerMessageIds(),
          `C8 seed ${seed}: answer message`,
        );
        const earlyShown = harness.displayed(answerId);
        expect(
          earlyShown,
          `C8 seed ${seed}: live text non-empty after the first batch`,
        ).toBeTruthy();
        assertPrefixOf(earlyShown ?? '', finalText, `C8 seed ${seed}: early live text`);

        // Remaining snapshots in grouped coalescer windows.
        emitGrouped(harness, streamEvents.slice(6), random, 3, 9);
        harness.runFrames();
        expect(
          harness.displayed(answerId),
          `C8 seed ${seed}: full text live before message_end`,
        ).toBe(finalText);
        expect(framesChecked, `C8 seed ${seed}: frame coverage`).toBeGreaterThan(0);

        // (a) the stream must be incremental: no full-text ContentPatch may
        // have crossed IPC for this session before message_end.
        expect(
          harness.sessionIpcEvents().filter(event => event.type === PiUiEventType.ContentPatch),
          `C8 seed ${seed}: no ContentPatch before message_end`,
        ).toHaveLength(0);

        // (c) terminal state: authoritative content, not streaming.
        harness.emitBatch(endEvents, 16);
        harness.settle();
        const answer = harness.message(answerId);
        expect(answer?.content, `C8 seed ${seed}: final content`).toBe(finalText);
        expect(answer?.metadata?.isStreaming, `C8 seed ${seed}: isStreaming`).toBe(false);
      });
    }
  }, 60_000);
});
