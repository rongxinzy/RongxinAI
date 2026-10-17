/**
 * Streaming GUARD tests — architecture invariants for the Cowork incremental
 * streaming chain introduced by PR #1119 (docs/architecture/streaming.md).
 *
 * Every guard drives the REAL production chain end to end via
 * tests/helpers/streamingPipelineHarness: Pi SDK mock → PiRuntimeAdapter →
 * forwardPiWorkbenchRuntimeToRenderer (UiMessageChunkCoalescer → sequencer →
 * webContents.send) → intercepted CoworkStreamIpc.UiEvent → renderer pipeline
 * (sequence tracker → rAF batchers) → LiveTextStore/Redux. Nothing about the
 * pipeline is re-implemented in the test: if production regresses (full-text
 * snapshots on the regular streaming path, per-delta IPC spam, per-delta cost
 * that grows with accumulated content, or the coalescer disappearing), the
 * corresponding guard fails.
 *
 * Import order is load-bearing: piRuntimeAdapter.testHarness registers the Pi
 * SDK mocks and must be evaluated before any module that transitively imports
 * the SDK. Keep the imports below in this order.
 */
import '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  PiUiEventType,
  PiTurnBuilder,
  buildCorpus,
  buildTextTurn,
  createStreamingHarness,
  mulberry32,
} from './helpers/streamingPipelineHarness';
import type { PiUiEvent, PiStreamEvent } from './helpers/streamingPipelineHarness';

import { describe, expect, it } from 'vitest';

// ─── local helpers (wire-level views over recorded UiEvents) ─────────────────

const jsonByteLength = (event: PiUiEvent): number =>
  Buffer.byteLength(JSON.stringify(event), 'utf8');

/**
 * Returns the `delta` of a StreamPart text-delta event, or null.
 * Cast through unknown: UIMessageChunk is imported type-only in production and
 * only the text-delta variant carries `delta`.
 */
const textDeltaPayload = (event: PiUiEvent): string | null => {
  if (event.type !== PiUiEventType.StreamPart) return null;
  const chunk = event.chunk as unknown as { type?: unknown; delta?: unknown };
  if (!chunk || chunk.type !== 'text-delta' || typeof chunk.delta !== 'string') return null;
  return chunk.delta;
};

const textDeltaEvents = (events: readonly PiUiEvent[]): PiUiEvent[] =>
  events.filter(event => textDeltaPayload(event) !== null);

/** Concatenation of every text-delta payload on the wire (order preserved). */
const joinedTextDeltas = (events: readonly PiUiEvent[]): string =>
  textDeltaEvents(events)
    .map(event => textDeltaPayload(event) ?? '')
    .join('');

const eventsOfType = (events: readonly PiUiEvent[], type: PiUiEvent['type']): PiUiEvent[] =>
  events.filter(event => event.type === type);

const isPiTextDelta = (event: PiStreamEvent): boolean =>
  event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta';

const medianOf = (samples: readonly number[]): number => {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** 2µs floor so the CPU ratio never divides by (or compares) timer noise. */
const CPU_FLOOR_NS = 2_000;
const withCpuFloor = (nanoseconds: number): number => Math.max(nanoseconds, CPU_FLOOR_NS);

// ─── guards ──────────────────────────────────────────────────────────────────

describe('streaming guards (Cowork end-to-end IPC pipeline)', () => {
  setupPiRuntimeAdapterSuite();

  /**
   * G1 — whole-round IPC byte budget.
   *
   * Guards: the streaming wire must carry the body ONCE as deltas plus bounded
   * per-event protocol overhead. A regression that snapshots full content on
   * every update (the pre-#1119 behavior) emits ≥ bodyBytes × eventCount, which
   * explodes past this budget for any event count > 2, so it cannot slip
   * through. The terminal slice (after message_end) is measured separately and
   * capped: architecture allows exactly the terminal snapshot, so the streaming
   * bound stays clean.
   *
   * Why the constants cannot be loosened to make a regression pass: 1.3× body +
   * 400 bytes/event IS the architecture budget (body once + envelope). Raising
   * either re-admits O(n²) IPC flooding while tests stay green.
   * **禁止**把全文快照当常规流式更新发 IPC —— the streaming-slice assertions
   * below (no MessageUpdate / ContentPatch, deltas sum to the body) enforce it.
   */
  it('G1 whole-round IPC stays within the incremental byte budget', async () => {
    const random = mulberry32(0x00c0_ffee);
    const body = buildCorpus(200_000, random); // ≥ 200KB of UTF-8 (CJK/emoji/latin)
    const bodyCodePoints = [...body].length;
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    const turn = buildTextTurn({
      text: body,
      random,
      minDelta: 8,
      maxDelta: 40,
      emitStartEnd: true,
    });
    const harness = await createStreamingHarness({ sessionId: 'guards-g1-byte-budget' });
    try {
      const streamingPiEvents = turn.streamEvents;
      const piDeltaCount = streamingPiEvents.filter(isPiTextDelta).length;
      expect(piDeltaCount).toBeGreaterThan(0);

      for (const event of streamingPiEvents) {
        harness.emitPi(event);
        harness.tick(1 + Math.floor(random() * 3)); // 1–3ms per delta, real cadence
      }
      // Elapsed time only (no manual flush API): the trailing coalescer window
      // fires before the terminal phase is recorded.
      harness.tick(64);
      const streamingEventCount = harness.sessionIpcEvents().length;

      for (const event of turn.endEvents) {
        harness.emitPi(event);
        harness.tick(17);
      }
      harness.tick(64);
      harness.flushDeliveries();
      harness.runFrames();

      const all = harness.sessionIpcEvents();
      const streaming = all.slice(0, streamingEventCount);
      const terminal = all.slice(streamingEventCount);

      // (a) Spec floor: at most chars/8 events. On its own this is weak (a
      // per-delta stream of 8cp deltas sits exactly on it) — hence (b).
      expect(all.length).toBeGreaterThan(0);
      expect(all.length).toBeLessThanOrEqual(Math.floor(bodyCodePoints / 8));
      // (b) Real coalescing proof: the whole round used at most half the Pi-side
      // delta count. A no-coalescer regression (one event per delta) fails here.
      expect(all.length).toBeLessThanOrEqual(Math.floor(piDeltaCount / 2) + 16);

      // (c) The streaming wire is delta-only and lossless: concatenated deltas
      // equal the body exactly once, and no snapshot events preceded message_end.
      expect(joinedTextDeltas(streaming)).toBe(body);
      expect(eventsOfType(streaming, PiUiEventType.MessageUpdate)).toHaveLength(0);
      expect(eventsOfType(streaming, PiUiEventType.ContentPatch)).toHaveLength(0);

      // (d) The byte budget on the streaming slice.
      const streamingBytes = streaming.reduce((total, event) => total + jsonByteLength(event), 0);
      expect(streamingBytes).toBeLessThanOrEqual(
        Math.round(1.3 * bodyBytes) + 400 * streaming.length,
      );

      // (e) Terminal snapshots are rare and bounded (message_end full state and
      // turn-completion bookkeeping only).
      expect(terminal.length).toBeLessThanOrEqual(8);
      const terminalBytes = terminal.reduce((total, event) => total + jsonByteLength(event), 0);
      expect(terminalBytes).toBeLessThanOrEqual(3 * bodyBytes + 8_000);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  /**
   * G2 — no snapshot IPC while streaming (before message_end).
   *
   * Guards: during regular streaming the renderer may only receive StreamPart
   * deltas. The runtime DOES emit `messageUpdate` bus events for every
   * message_update (asserted non-zero below, so this guard is not vacuous) — a
   * "fix" that simply re-forwards all of them would pass content tests while
   * flooding full-text snapshots per delta. This guard blocks that shortcut.
   *
   * Why it cannot be loosened: allowing even one MessageUpdate/ContentPatch
   * during regular streaming legalizes snapshot-per-update IPC, which is
   * exactly the regression G1's byte budget exists to catch.
   * **禁止**在常规流式期间转发 runtime 的非终态 messageUpdate。
   */
  it('G2 no MessageUpdate/ContentPatch on IPC while streaming (deltas only)', async () => {
    const random = mulberry32(0x00feed01);
    const body = buildCorpus(4_000, random);
    const turn = buildTextTurn({
      text: body,
      random,
      emitStartEnd: true,
    });
    const streamingPiEvents = turn.streamEvents;
    const harness = await createStreamingHarness({ sessionId: 'guards-g2-no-snapshot-streaming' });
    try {
      for (const event of streamingPiEvents) {
        harness.emitPi(event);
        harness.tick(2);
      }
      harness.tick(64); // let the trailing coalescer window fire (no manual flush)
      harness.runFrames();

      // Non-vacuous: the adapter's messageUpdate bus was active while streaming.
      expect(harness.messageUpdateBusCount()).toBeGreaterThan(0);

      const events = harness.sessionIpcEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(eventsOfType(events, PiUiEventType.MessageUpdate)).toHaveLength(0);
      expect(eventsOfType(events, PiUiEventType.ContentPatch)).toHaveLength(0);
      // And the delta path itself was live and complete over the wire.
      expect(joinedTextDeltas(events)).toBe(body);

      // Finish the turn politely (terminal snapshot is allowed AFTER this point;
      // G1 bounds its size).
      for (const event of turn.endEvents) {
        harness.emitPi(event);
        harness.tick(17);
      }
      harness.tick(64);
      harness.flushDeliveries();
      harness.runFrames();
    } finally {
      harness.dispose();
    }
  }, 10_000);

  /**
   * G3 — per-delta main-process CPU must be flat in accumulated content size.
   *
   * Guards: the translate → coalesce path must be O(delta), never
   * O(accumulated text) (re-diffing or re-serializing the full snapshot per
   * delta). Such implementations pass functional tests and then fall over on
   * 2MB answers. We fill the same message to ~10KB, measure 300 timed 16-char
   * deltas, fill to ~1MB, measure again, and compare medians of the raw
   * `listener(event)` hrtime cost. Fake timers keep timer work out of the timed
   * region; cumulative Pi snapshots are pre-built OUTSIDE the timed region
   * (string concatenation for the 1MB blocks is not measured); warmup deltas
   * absorb JIT noise; medians absorb GC spikes.
   *
   * Why it cannot be loosened: raising the 1.5 ratio (or dropping the 1MB leg)
   * would ship quadratic per-delta work that only manifests on real long
   * answers. The 2µs floor only prevents ratio-of-noise on sub-microsecond
   * medians — it never masks a real slowdown, because an O(content) regression
   * at 1MB is orders of magnitude slower, not 2µs slower.
   */
  it('G3 per-delta main-process cost stays flat from 10KB to 1MB of content', async () => {
    const harness = await createStreamingHarness({ sessionId: 'guards-g3-per-delta-cpu' });
    try {
      const builder = new PiTurnBuilder(mulberry32(0x00feed02));
      const fillChunk = 'qwertyuiopasdfghjklzxcvbnm0123456789 '.repeat(128).slice(0, 4_000);
      const deltaPool = Array.from({ length: 64 }, (_, index) =>
        `${String(index).padStart(3, '0')}-abcdefghijklmnopqrstuvwxyz`.slice(0, 16),
      );
      const warmupCount = 64;
      const measuredCount = 300;
      let streamedChars = 0;

      harness.emitPi(builder.agentStart());
      harness.emitPi(builder.turnStart());
      harness.emitPi(builder.messageStart());
      harness.emitPi(builder.beginTextPart(0));
      harness.tick(1);

      /** Fast-fill with big deltas — deliberately NOT timed. */
      const fillTo = (targetChars: number): void => {
        let fillsSinceTick = 0;
        while (streamedChars < targetChars) {
          harness.emitPi(builder.appendText(0, fillChunk));
          streamedChars += fillChunk.length;
          fillsSinceTick += 1;
          if (fillsSinceTick >= 8) {
            harness.tick(17);
            fillsSinceTick = 0;
          }
        }
        harness.tick(64);
        harness.runFrames();
      };

      /** Warm up, then time each listener(event) call; returns ns samples. */
      const measureDeltas = (): number[] => {
        // Pre-build (cumulative snapshot assembly outside the timed region).
        const prebuilt: PiStreamEvent[] = [];
        for (let index = 0; index < warmupCount + measuredCount; index += 1) {
          const delta = deltaPool[index % deltaPool.length] ?? '';
          prebuilt.push(builder.appendText(0, delta));
          streamedChars += delta.length;
        }
        const samples: number[] = [];
        for (const [index, event] of prebuilt.entries()) {
          const startedAt = process.hrtime.bigint();
          harness.emitPi(event);
          const elapsedNs = Number(process.hrtime.bigint() - startedAt);
          if (index >= warmupCount) samples.push(elapsedNs);
        }
        harness.tick(64); // flush the measured window (outside timing)
        harness.runFrames();
        return samples;
      };

      fillTo(10_000);
      const medianAt10k = medianOf(measureDeltas());
      expect(medianAt10k).toBeGreaterThan(0);

      fillTo(1_000_000);
      expect(streamedChars).toBeGreaterThanOrEqual(1_000_000);
      const medianAt1M = medianOf(measureDeltas());
      expect(medianAt1M).toBeGreaterThan(0);

      const ratio = withCpuFloor(medianAt1M) / withCpuFloor(medianAt10k);
      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeLessThan(1.5);

      // End the turn and prove the whole 1MB actually flowed over the wire as
      // deltas (the CPU leg was not measuring a no-op path).
      harness.emitPi(builder.messageEnd());
      harness.emitPi(builder.turnEnd());
      harness.emitPi(builder.agentEnd());
      harness.emitPi(builder.agentSettled());
      harness.tick(64);
      harness.flushDeliveries();
      harness.runFrames();
      expect(joinedTextDeltas(harness.sessionIpcEvents())).toBe(builder.textSoFar());
    } finally {
      harness.dispose();
    }
  }, 30_000);

  /**
   * G4 — the coalescer window merges many deltas into few IPC events, and keeps
   * streaming while doing so.
   *
   * Guards: the main process has exactly ONE merge point (the 16ms
   * UiMessageChunkCoalescer). At a 1 delta/ms cadence for 320ms with no manual
   * flush, the wire must show at most ~ceil(320/16)+2 text-delta events
   * (per-delta IPC spam fails this) and at least 320/32−2 (buffering the whole
   * turn until the end fails this — latency would die).
   *
   * Why it cannot be loosened: raising the upper bound re-admits per-delta IPC
   * floods; dropping the lower bound legalizes "hold everything and emit once",
   * which no longer streams at all. The final equality also proves merging is
   * lossless and order-preserving.
   * **禁止**在发送端增加第二处合并/缓冲点。
   */
  it('G4 coalescer emits about one merged text-delta event per 16ms window', async () => {
    const harness = await createStreamingHarness({ sessionId: 'guards-g4-coalescer-window' });
    try {
      const builder = new PiTurnBuilder(mulberry32(0x00feed03));
      harness.emitPi(builder.agentStart());
      harness.emitPi(builder.turnStart());
      harness.emitPi(builder.messageStart());
      harness.emitPi(builder.beginTextPart(0));
      harness.tick(1);

      for (let index = 0; index < 320; index += 1) {
        harness.emitPi(builder.appendText(0, `${String(index % 10_000).padStart(4, '0')}-abc`));
        harness.tick(1); // exactly 1 delta per ms; NO manual flush in this test
      }

      const sessionEvents = harness.sessionIpcEvents();
      const merged = textDeltaEvents(sessionEvents);
      expect(merged.length).toBeGreaterThan(0);
      // Upper bound: one merged event per 16ms window (+2 for boundary jitter).
      expect(merged.length).toBeLessThanOrEqual(Math.ceil(320 / 16) + 2);
      // Lower bound: the stream is NOT buffered until the end.
      expect(merged.length).toBeGreaterThanOrEqual(320 / 32 - 2);
      // Merging is lossless and order-preserving.
      expect(joinedTextDeltas(sessionEvents)).toBe(builder.textSoFar());

      harness.tick(64);
      harness.flushDeliveries();
      harness.runFrames();
    } finally {
      harness.dispose();
    }
  }, 10_000);
});
