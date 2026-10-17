import { expect, test } from 'vitest';
import type { UIMessageChunk } from 'ai';

import { CoworkRunPolicy } from '../src/shared/cowork/runState';
import { LiveTextStore } from '../src/renderer/services/liveTextStore';
import { UiMessageChunkCoalescer } from '../src/main/streaming/uiMessageChunkCoalescer';
import { snapshotToContentPatches } from '../src/main/piUiStreamGateway';
import { CoworkContentBuffer } from '../src/renderer/services/coworkContentBuffer';
import {
  createPiTranslatorState,
  translatePiSessionEventToUiChunks,
} from '../src/main/libs/agentEngine/piTranslate/piTranslateUiMessageChunk';

const mulberry32 = (seed: number) => {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const corpusPieces = [
  '中文段落',
  '🙂🙃',
  '\uD83D\uDE00',
  '```ts\nconst x = 1;\n',
  '| a | b |\n|---|---|\n| 1 | 2 |\n',
  '$$\\alpha$$',
  'C:\\Users\\dev\\project\\README.md',
  'paragraph with **bold**',
];

const randomPiece = (rand: () => number): string =>
  corpusPieces[Math.floor(rand() * corpusPieces.length)]!;

const applyChunks = (live: LiveTextStore, messageId: string, chunks: UIMessageChunk[]): void => {
  for (const chunk of chunks) live.applyChunk(messageId, chunk);
};

const simulateStream = (
  seed: number,
  options?: { injectReset?: boolean; truncate?: boolean; dropAttach?: boolean },
): { final: string; steps: string[] } => {
  const rand = mulberry32(seed);
  const state = createPiTranslatorState();
  const live = new LiveTextStore();
  const coalesced: Array<{ messageId: string; chunk: UIMessageChunk }> = [];
  const coalescer = new UiMessageChunkCoalescer(({ messageId, chunk }) => {
    coalesced.push({ messageId, chunk });
    live.applyChunk(messageId, chunk);
  });
  const messageId = `msg-${seed}`;
  translatePiSessionEventToUiChunks({ type: 'turn_start' }, state);
  let finalText = '';
  const steps: string[] = [];
  const frames = 20 + Math.floor(rand() * 40);
  for (let frame = 0; frame < frames; frame += 1) {
    if (options?.injectReset && frame === Math.floor(frames / 2)) {
      const snapshot = finalText.slice(0, 8);
      for (const patch of snapshotToContentPatches(
        's',
        { messageId, content: snapshot, truncated: false },
        1,
      )) {
        live.setSnapshot(messageId, patch.content);
        steps.push(live.getSnapshot(messageId) ?? '');
      }
    }
    const piece = randomPiece(rand);
    finalText += piece;
    if (options?.truncate && finalText.length > CoworkRunPolicy.MaximumContentCharacters + 1000) {
      break;
    }
    for (const ch of piece) {
      const chunks = translatePiSessionEventToUiChunks(
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ch },
        },
        state,
      );
      for (const chunk of chunks) {
        coalescer.push('s', messageId, chunk);
      }
    }
  }
  coalescer.flush();
  const authoritative = options?.truncate
    ? finalText.slice(0, CoworkRunPolicy.MaximumContentCharacters)
    : finalText;
  const endChunks = translatePiSessionEventToUiChunks(
    {
      type: 'message_end',
      message: { role: 'assistant', content: authoritative },
    },
    state,
  );
  applyChunks(live, messageId, endChunks);
  if (live.getSnapshot(messageId) !== authoritative) {
    const buffer = new CoworkContentBuffer(() => {});
    for (const patch of snapshotToContentPatches(
      's',
      { messageId, content: authoritative, truncated: false },
      2,
    )) {
      buffer.apply(patch);
      live.setSnapshot(messageId, buffer.live(messageId) ?? patch.content);
    }
  }
  steps.push(live.getSnapshot(messageId) ?? '');
  if (options?.dropAttach) {
    const replay = new LiveTextStore();
    for (const entry of coalesced.slice(Math.floor(coalesced.length / 3))) {
      replay.applyChunk(entry.messageId, entry.chunk);
    }
    applyChunks(replay, messageId, endChunks);
    return {
      final: authoritative,
      steps: [...steps, replay.getSnapshot(messageId) ?? ''],
    };
  }
  return { final: authoritative, steps };
};

test('400+ random streams match message_end bytes and steps are prefixes or snapshots', () => {
  for (let seed = 0; seed < 420; seed += 1) {
    const mode = seed % 5;
    const result = simulateStream(seed, {
      injectReset: mode === 1,
      truncate: mode === 2,
      dropAttach: mode === 3,
    });
    const last = result.steps.at(-1) ?? '';
    expect(last).toBe(result.final);
    for (const step of result.steps) {
      expect(result.final.startsWith(step) || step === result.final).toBe(true);
    }
  }
});
