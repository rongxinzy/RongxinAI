/**
 * Cowork streaming delta-less snapshot coverage — scenarios C9..C10 (Kimi N-4).
 *
 * `piRuntimeTurnEvents` handles cumulative `message_update` snapshots WITHOUT an
 * `assistantMessageEvent` (delta-less) through three paths:
 *   (1) pure suffix extension of the prior part text → synthesized start/delta
 *       chunks (reasoning synthesis first closes an open text part, text
 *       synthesis first closes an open reasoning part — same as the translator);
 *   (2) text identical to prior → nothing is emitted;
 *   (3) non-prefix rewrite → close parts + uiStreamSnapshot (the forwarder turns
 *       it into a ContentPatch with metadata.isStreaming=true; the renderer
 *       adopts it as the LiveTextStore base).
 * C8 (streamingConsistency.test.ts) covers path (1) for the answer side only:
 *   C9 — thinking AND answer both grow via delta-less suffix extensions, and no
 *        ContentPatch may cross IPC before message_end;
 *   C10 — a non-prefix rewrite followed by delta-less suffix extensions; the
 *        only ContentPatch traffic is the live isStreaming base at the rewrite.
 *
 * Both scenarios drive the REAL production chain end to end (mock Pi SDK →
 * PiRuntimeAdapter → forwarder → intercepted UiEvent IPC → renderer pipeline →
 * LiveTextStore → real coworkReducer). Tests only feed Pi events at one edge
 * and assert observable behavior at the renderer/IPC edges. **禁止**在测试内
 * 重新拼装链路、扫描源码文本或放宽为“近似”断言。
 *
 * Import order matters: the Pi SDK mock module must be evaluated before any
 * module that transitively loads Pi SDK mocks.
 */
import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  PiTurnBuilder,
  buildCorpus,
  createStreamingHarness,
  mulberry32,
  splitIntoDeltas,
  type PiStreamEvent,
  type StreamingHarness,
} from './helpers/streamingPipelineHarness';
import { PiUiEventType } from '../src/shared/cowork/piUiEvent';
import type { PiUiEvent } from '../src/shared/cowork/piUiEvent';
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

/**
 * A delta-less non-prefix rewrite must cross IPC as a ContentPatch whose
 * metadata flags a LIVE base (`isStreaming: true`), never a terminal
 * full-content snapshot.
 */
function contentPatchIsStreaming(event: PiUiEvent): boolean {
  if (event.type !== PiUiEventType.ContentPatch) return false;
  return event.patch.metadata?.isStreaming === true;
}

/** Cumulative prefixes of `text`: strictly growing; the last equals `text`. */
function growingPrefixes(text: string, count: number): string[] {
  const prefixes: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    prefixes.push(text.slice(0, Math.floor((text.length * index) / count)));
  }
  return prefixes;
}

// ─── scenarios ────────────────────────────────────────────────────────────────

describe('Cowork streaming delta-less coverage C9–C10 (real end-to-end pipeline)', () => {
  setupPiRuntimeAdapterSuite();

  it('C9/N-4: thinking + answer grow via delta-less snapshots; no ContentPatch (20 seeds)', async () => {
    const seedCount = 20;
    for (let seed = 0; seed < seedCount; seed += 1) {
      await withStreamingHarness(`seed-c9-${seed}`, harness => {
        const random = mulberry32(0x5eed_c900 + seed * 103);
        const finalThinking = buildCorpus(180 + Math.floor(random() * 320), random);
        const finalText = buildCorpus(180 + Math.floor(random() * 320), random);
        const thinkingUpdates = 15 + Math.floor(random() * 16); // 15–30 snapshots
        const textUpdates = 15 + Math.floor(random() * 16); // 15–30 snapshots
        const builder = new PiTurnBuilder(random);
        const streamEvents: PiStreamEvent[] = [
          builder.agentStart(),
          builder.turnStart(),
          builder.messageStart(),
          builder.beginThinkingPart(0),
          builder.beginTextPart(1),
        ];
        // Phase 1 — snapshots growing ONLY the thinking block (delta-less).
        for (const prefix of growingPrefixes(finalThinking, thinkingUpdates)) {
          streamEvents.push(builder.rewriteThinking(prefix));
        }
        // Phase 2 — snapshots growing ONLY the text block (delta-less).
        for (const prefix of growingPrefixes(finalText, textUpdates)) {
          streamEvents.push(builder.rewriteText(prefix));
        }
        expect(builder.thinkingSoFar(), `C9 seed ${seed}: builder sanity`).toBe(finalThinking);
        expect(builder.textSoFar(), `C9 seed ${seed}: builder sanity`).toBe(finalText);
        const endEvents: PiStreamEvent[] = [
          builder.messageEnd('stop'),
          builder.turnEnd(),
          builder.agentEnd(),
          builder.agentSettled(),
        ];

        // Per-frame invariant: both bubbles only ever display prefixes.
        let framesChecked = 0;
        harness.onFrame(() => {
          const answerId = harness.answerMessageIds()[0];
          if (answerId !== undefined) {
            const shown = harness.displayed(answerId);
            if (shown !== undefined) {
              framesChecked += 1;
              assertPrefixOf(shown, finalText, `C9 seed ${seed} answer frame`);
            }
          }
          const thinkingId = harness.thinkingMessageIds()[0];
          if (thinkingId !== undefined) {
            const shown = harness.displayed(thinkingId);
            if (shown !== undefined) {
              assertPrefixOf(shown, finalThinking, `C9 seed ${seed} thinking frame`);
            }
          }
        });

        emitGrouped(harness, streamEvents, random, 3, 9);
        harness.runFrames();

        const answerId = requireFirstId(
          harness.answerMessageIds(),
          `C9 seed ${seed}: answer message`,
        );
        const thinkingId = requireFirstId(
          harness.thinkingMessageIds(),
          `C9 seed ${seed}: thinking message`,
        );
        expect(
          harness.displayed(answerId),
          `C9 seed ${seed}: full text live before message_end`,
        ).toBe(finalText);
        expect(
          harness.displayed(thinkingId),
          `C9 seed ${seed}: full thinking live before message_end`,
        ).toBe(finalThinking);
        expect(framesChecked, `C9 seed ${seed}: frame coverage`).toBeGreaterThan(0);

        // Suffix-extension snapshots must translate to deltas on the wire: no
        // full-content ContentPatch may cross IPC before message_end.
        expect(
          harness.sessionIpcEvents().filter(event => event.type === PiUiEventType.ContentPatch),
          `C9 seed ${seed}: no ContentPatch before message_end`,
        ).toHaveLength(0);

        harness.emitBatch(endEvents, 16);
        harness.settle();
        const answer = harness.message(answerId);
        expect(answer?.content, `C9 seed ${seed}: final answer content`).toBe(finalText);
        expect(answer?.metadata?.isStreaming, `C9 seed ${seed}: answer isStreaming`).toBe(false);
        const thinking = harness.message(thinkingId);
        expect(thinking?.content, `C9 seed ${seed}: final thinking content`).toBe(finalThinking);
        expect(thinking?.metadata?.isStreaming, `C9 seed ${seed}: thinking isStreaming`).toBe(
          false,
        );
      });
    }
  }, 60_000);

  it('C10/N-4: delta-less non-prefix rewrite emits an isStreaming ContentPatch base (20 seeds)', async () => {
    const seedCount = 20;
    for (let seed = 0; seed < seedCount; seed += 1) {
      await withStreamingHarness(`seed-c10-${seed}`, harness => {
        const random = mulberry32(0x5eed_ca00 + seed * 107);
        const initialText = buildCorpus(30 + Math.floor(random() * 170), random);
        // '#' is never a corpus first character, so the rewritten text can
        // neither extend nor be a prefix-compatible successor of the streamed
        // initial text — the rewrite is guaranteed non-prefix.
        const rewrittenText = `#${buildCorpus(60 + Math.floor(random() * 200), random)}`;
        const suffixText = buildCorpus(60 + Math.floor(random() * 240), random);
        const extensions = 12 + Math.floor(random() * 9); // 12–20 snapshots
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
        const rewriteIndex = streamEvents.length;
        streamEvents.push(builder.rewriteText(rewrittenText));
        // Delta-less suffix extensions of the rewritten text (still no
        // assistantMessageEvent — cumulative snapshots on the Pi wire).
        for (const prefix of growingPrefixes(suffixText, extensions)) {
          streamEvents.push(builder.rewriteText(rewrittenText + prefix));
        }
        const finalText = rewrittenText + suffixText;
        expect(builder.textSoFar(), `C10 seed ${seed}: builder sanity`).toBe(finalText);
        const endEvents: PiStreamEvent[] = [
          builder.messageEnd('stop'),
          builder.turnEnd(),
          builder.agentEnd(),
          builder.agentSettled(),
        ];

        // Phase 1 — everything up to and including the non-prefix rewrite.
        emitGrouped(harness, streamEvents.slice(0, rewriteIndex + 1), random, 3, 8);
        harness.runFrames();
        const answerId = requireFirstId(
          harness.answerMessageIds(),
          `C10 seed ${seed}: answer message`,
        );
        expect(
          harness.displayed(answerId),
          `C10 seed ${seed}: displayed right after the rewrite`,
        ).toBe(rewrittenText);

        // Phase 2 — delta-less extensions; every frame stays a prefix.
        let framesChecked = 0;
        harness.onFrame(() => {
          const shown = harness.displayed(answerId);
          if (shown === undefined) return;
          framesChecked += 1;
          assertPrefixOf(shown, finalText, `C10 seed ${seed} frame`);
        });
        emitGrouped(harness, streamEvents.slice(rewriteIndex + 1), random, 3, 8);
        harness.runFrames();
        expect(
          harness.displayed(answerId),
          `C10 seed ${seed}: full text live before message_end`,
        ).toBe(finalText);
        expect(framesChecked, `C10 seed ${seed}: frame coverage`).toBeGreaterThan(0);

        // The non-prefix rewrite must cross IPC as ContentPatch traffic whose
        // metadata marks a LIVE base; later suffix extensions must not add
        // terminal snapshot traffic before message_end.
        const patches = harness
          .sessionIpcEvents()
          .filter(event => event.type === PiUiEventType.ContentPatch);
        expect(
          patches.length,
          `C10 seed ${seed}: at least one ContentPatch before message_end`,
        ).toBeGreaterThanOrEqual(1);
        expect(
          patches.every(event => contentPatchIsStreaming(event)),
          `C10 seed ${seed}: every ContentPatch before message_end is isStreaming`,
        ).toBe(true);

        harness.emitBatch(endEvents, 16);
        harness.settle();
        const answer = harness.message(answerId);
        expect(answer?.content, `C10 seed ${seed}: final content`).toBe(finalText);
        expect(answer?.metadata?.isStreaming, `C10 seed ${seed}: isStreaming`).toBe(false);
      });
    }
  }, 60_000);
});
