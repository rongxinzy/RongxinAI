/**
 * Design reference: CherryHQ/cherry-studio (AGPL-3.0)
 * Path: src/main/ai/streamManager/buildCompactReplay.ts
 * Commit: main branch (2026-10-17)
 * License: AGPL-3.0 — algorithm reference only; rewritten for Pi UI stream replay.
 */
import type { UIMessageChunk } from 'ai';

import { StreamCoalesceLimits } from './streamLimits';

export type BufferedStreamChunk = {
  sessionId: string;
  messageId: string;
  chunk: UIMessageChunk;
};

const utf8CodePointBytes = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)!;
    bytes += utf8CodePointBytes(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
};

const splitUtf8 = (value: string, maxBytes: number): string[] => {
  if (!value) return [''];
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return [value];
  const segments: string[] = [];
  let segmentStart = 0;
  let segmentBytes = 0;
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)!;
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    const codePointBytes = utf8CodePointBytes(codePoint);
    if (segmentBytes > 0 && segmentBytes + codePointBytes > maxBytes) {
      segments.push(value.slice(segmentStart, index));
      segmentStart = index;
      segmentBytes = 0;
    }
    segmentBytes += codePointBytes;
    index += codeUnits;
  }
  segments.push(value.slice(segmentStart));
  return segments;
};

const splitBufferedDelta = (
  payload: BufferedStreamChunk,
  maxDeltaBytes: number,
): BufferedStreamChunk[] => {
  const chunk = payload.chunk;
  if (
    chunk.type !== 'text-delta' &&
    chunk.type !== 'reasoning-delta' &&
    chunk.type !== 'tool-input-delta'
  ) {
    return [payload];
  }
  const value = chunk.type === 'tool-input-delta' ? chunk.inputTextDelta : chunk.delta;
  const segments = splitUtf8(value, maxDeltaBytes);
  if (segments.length === 1) return [payload];
  return segments.map(segment => {
    if (chunk.type === 'tool-input-delta') {
      return {
        ...payload,
        chunk: { ...chunk, inputTextDelta: segment },
      };
    }
    return { ...payload, chunk: { ...chunk, delta: segment } };
  });
};

const mergeBufferedDelta = (
  tail: BufferedStreamChunk,
  incoming: BufferedStreamChunk,
  maxDeltaBytes = StreamCoalesceLimits.ReplayMaxDeltaBytes,
): BufferedStreamChunk | undefined => {
  if (tail.sessionId !== incoming.sessionId || tail.messageId !== incoming.messageId) {
    return undefined;
  }
  const prev = tail.chunk;
  const next = incoming.chunk;
  if (prev.type === 'text-delta' && next.type === 'text-delta' && prev.id === next.id) {
    const merged = prev.delta + next.delta;
    if (utf8ByteLength(merged) > maxDeltaBytes) return undefined;
    return { ...tail, chunk: { ...prev, delta: merged } };
  }
  if (prev.type === 'reasoning-delta' && next.type === 'reasoning-delta' && prev.id === next.id) {
    const merged = prev.delta + next.delta;
    if (utf8ByteLength(merged) > maxDeltaBytes) return undefined;
    return { ...tail, chunk: { ...prev, delta: merged } };
  }
  if (
    prev.type === 'tool-input-delta' &&
    next.type === 'tool-input-delta' &&
    prev.toolCallId === next.toolCallId
  ) {
    const merged = prev.inputTextDelta + next.inputTextDelta;
    if (utf8ByteLength(merged) > maxDeltaBytes) return undefined;
    return { ...tail, chunk: { ...prev, inputTextDelta: merged } };
  }
  return undefined;
};

export const buildCompactReplay = (
  buffer: readonly BufferedStreamChunk[],
  maxDeltaBytes = StreamCoalesceLimits.ReplayMaxDeltaBytes,
): BufferedStreamChunk[] => {
  const compact: BufferedStreamChunk[] = [];
  let pending: BufferedStreamChunk | undefined;
  const openParts = new Set<string>();
  const openPartKey = (payload: BufferedStreamChunk, kind: 'text' | 'reasoning', id: string) =>
    `${payload.sessionId}:${payload.messageId}:${kind}:${id}`;

  const flushPending = (): void => {
    if (!pending) return;
    for (const piece of splitBufferedDelta(pending, maxDeltaBytes)) {
      compact.push(piece);
    }
    pending = undefined;
  };

  for (const payload of buffer) {
    if (pending) {
      const merged = mergeBufferedDelta(pending, payload, maxDeltaBytes);
      if (merged) {
        pending = merged;
        continue;
      }
    }
    const chunk = payload.chunk;
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start': {
        flushPending();
        openParts.add(
          openPartKey(payload, chunk.type === 'text-start' ? 'text' : 'reasoning', chunk.id),
        );
        compact.push(payload);
        break;
      }
      case 'text-delta':
      case 'reasoning-delta': {
        flushPending();
        const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning';
        const key = openPartKey(payload, kind, chunk.id);
        if (!openParts.has(key)) {
          openParts.add(key);
          compact.push({
            ...payload,
            chunk: { type: `${kind}-start`, id: chunk.id },
          });
        }
        pending = payload;
        break;
      }
      case 'text-end':
      case 'reasoning-end': {
        flushPending();
        const kind = chunk.type === 'text-end' ? 'text' : 'reasoning';
        if (!openParts.has(openPartKey(payload, kind, chunk.id))) break;
        compact.push(payload);
        break;
      }
      case 'tool-input-delta':
        flushPending();
        pending = payload;
        break;
      default:
        flushPending();
        compact.push(payload);
        break;
    }
  }
  flushPending();
  return compact;
};
