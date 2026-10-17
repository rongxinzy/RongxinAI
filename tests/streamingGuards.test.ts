/**
 * Behavioral guards for the Cowork streaming pipeline.
 *
 * These tests intentionally fail if someone reintroduces full-text snapshot IPC,
 * a second send-side throttle, or send-side "accumulate full text then diff" logic.
 * Do NOT weaken thresholds to make tests pass — fix the architecture instead.
 * See docs/architecture/streaming.md.
 */
import { serialize } from 'node:v8';
import { expect, test } from 'vitest';
import type { UIMessageChunk } from 'ai';

import { PiUiEventSequencer, PiUiEventType, type PiUiEvent } from '../src/shared/cowork/piUiEvent';
import { UiMessageChunkCoalescer } from '../src/main/streaming/uiMessageChunkCoalescer';
import {
  createPiTranslatorState,
  translatePiSessionEventToUiChunks,
  type PiTranslatorState,
} from '../src/main/libs/agentEngine/piTranslate/piTranslateUiMessageChunk';

/** Fixed envelope overhead per PiUiEvent (metadata, ids, protocol fields). */
const IPC_EVENT_ENVELOPE_BYTES = 420;
const LINEAR_BODY_FACTOR = 1.3;

const buildSequencedStreamPart = (
  sequencer: PiUiEventSequencer,
  sessionId: string,
  messageId: string,
  chunk: UIMessageChunk,
): PiUiEvent => {
  return sequencer.next({
    type: PiUiEventType.StreamPart,
    sessionId,
    messageId,
    chunk,
  });
};

const emitOneCharThroughPipeline = (
  state: PiTranslatorState,
  coalescer: UiMessageChunkCoalescer,
  char: string,
): void => {
  const chunks = translatePiSessionEventToUiChunks(
    {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: char },
    },
    state,
  );
  for (const chunk of chunks) {
    coalescer.push('session', 'message', chunk);
  }
  coalescer.flush();
};

const prefillTranslatorText = (state: PiTranslatorState, charCount: number): void => {
  translatePiSessionEventToUiChunks({ type: 'turn_start' }, state);
  let remaining = charCount;
  while (remaining > 0) {
    const batch = Math.min(remaining, 1024);
    let delta = '';
    for (let i = 0; i < batch; i += 1) {
      delta += String.fromCharCode(97 + (i % 26));
    }
    translatePiSessionEventToUiChunks(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
      },
      state,
    );
    remaining -= batch;
  }
};

const runMonotonicTextStream = (
  charCount: number,
  options?: { prefillChars?: number },
): {
  bodyText: string;
  ipcEvents: PiUiEvent[];
  perDeltaPayloadBytes: number[];
} => {
  const state = createPiTranslatorState();
  const prefill = options?.prefillChars ?? 0;
  if (prefill > 0) {
    prefillTranslatorText(state, prefill);
  } else {
    translatePiSessionEventToUiChunks({ type: 'turn_start' }, state);
  }
  const sequencer = new PiUiEventSequencer(() => 'evt-id');
  const ipcEvents: PiUiEvent[] = [];
  const perDeltaPayloadBytes: number[] = [];
  const coalescer = new UiMessageChunkCoalescer(({ sessionId, messageId, chunk }) => {
    const event = buildSequencedStreamPart(sequencer, sessionId, messageId, chunk);
    ipcEvents.push(event);
    if (chunk.type === 'text-delta') {
      perDeltaPayloadBytes.push(serialize(event).byteLength);
    }
  });

  let bodyText = 'x'.repeat(prefill);
  for (let i = 0; i < charCount; i += 1) {
    const ch = String.fromCharCode(97 + (i % 26));
    bodyText += ch;
    emitOneCharThroughPipeline(state, coalescer, ch);
  }
  coalescer.dispose();
  return { bodyText, ipcEvents, perDeltaPayloadBytes };
};

test('IPC bytes stay linear in body length (guards against #1115-style full snapshots)', () => {
  // A full-snapshot-on-every-token design sends 1+2+…+N characters → Θ(N²) bytes.
  // Incremental StreamPart must stay ~O(N). Loosening 1.3× or envelope allows O(N²) back in.
  const sizes = [2_000, 8_000];
  for (const charCount of sizes) {
    const { bodyText, ipcEvents } = runMonotonicTextStream(charCount);
    const streamParts = ipcEvents.filter(e => e.type === PiUiEventType.StreamPart);
    const totalIpcBytes = ipcEvents.reduce((sum, e) => sum + serialize(e).byteLength, 0);
    const budget =
      bodyText.length * LINEAR_BODY_FACTOR + streamParts.length * IPC_EVENT_ENVELOPE_BYTES;
    expect(totalIpcBytes).toBeLessThanOrEqual(budget);

    const naiveFullSnapshotBytes = (bodyText.length * (bodyText.length + 1)) / 2;
    expect(totalIpcBytes).toBeLessThan(naiveFullSnapshotBytes * 0.2);
  }
});

test('monotonic streaming emits no full-text snapshot IPC events', () => {
  // Routine prefix-only text deltas must not emit MessageUpdate or ContentPatch on the Cowork UI path.
  // Re-adding those for each token bypasses LiveTextStore increments and restores O(N²) traffic.
  const { ipcEvents } = runMonotonicTextStream(500);
  for (const event of ipcEvents) {
    expect(event.type).toBe(PiUiEventType.StreamPart);
    if (event.type === PiUiEventType.StreamPart) {
      expect(event.chunk.type === 'text-delta' || event.chunk.type === 'text-start').toBe(true);
      if (event.chunk.type === 'text-delta') {
        expect(event.chunk.delta.length).toBeLessThanOrEqual(2048);
      }
    }
  }
  expect(ipcEvents.some(e => e.type === PiUiEventType.ContentPatch)).toBe(false);
  expect(ipcEvents.some(e => e.type === PiUiEventType.MessageUpdate)).toBe(false);
});

test('per-delta IPC payload and emit count do not grow with accumulated text length', () => {
  // Send-side work per token must not scale with message size (e.g. embedding entire prefix in each IPC).
  const measuredTail = 40;
  const shortRun = runMonotonicTextStream(10_000);
  const longRun = runMonotonicTextStream(measuredTail, { prefillChars: 1_000_000 - measuredTail });

  const shortTail = shortRun.perDeltaPayloadBytes.slice(-measuredTail);
  const longTail = longRun.perDeltaPayloadBytes;
  expect(shortTail.length).toBe(measuredTail);
  expect(longTail.length).toBe(measuredTail);

  const shortMedian = median(shortTail);
  const longMedian = median(longTail);
  expect(longMedian).toBeLessThanOrEqual(shortMedian * 1.15);

  const shortPerCharEmits = shortRun.ipcEvents.length / shortRun.bodyText.length;
  const longPerCharEmits = longRun.ipcEvents.length / measuredTail;
  expect(longPerCharEmits).toBeLessThanOrEqual(shortPerCharEmits * 1.05);
});

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};
