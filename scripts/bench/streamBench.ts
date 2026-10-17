/**
 * Synthetic Pi stream replay benchmark for main-process IPC coalescing.
 * Usage: bun run bench:stream [--variant=phase12] [--rate=200] [--size=100kb]
 */
import crypto from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';

import {
  createPiTranslatorState,
  translatePiSessionEventToUiChunks,
} from '../../src/main/libs/agentEngine/piTranslate/piTranslateUiMessageChunk';
import { UiMessageChunkCoalescer } from '../../src/main/streaming/uiMessageChunkCoalescer';
import { PiUiEventSequencer, PiUiEventType } from '../../src/shared/cowork/piUiEvent';

type Variant = 'phase12' | 'fullsnapshot';

const parseArg = (name: string, fallback: string): string => {
  const hit = process.argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1]! : fallback;
};

const sizeKey = parseArg('size', '100kb').toLowerCase();
const rate = Number.parseInt(parseArg('rate', '200'), 10);
const variant = parseArg('variant', 'phase12') as Variant;

const targetChars = sizeKey === '2mb' ? 2_000_000 : 100_000;

const corpus =
  '混合 markdown：段落与 **bold**。\n\n```ts\nexport const x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nC:\\\\Users\\\\dev\\\\README.md\n';

const buildPayload = (): string => {
  let out = '';
  while (out.length < targetChars) out += corpus;
  return out.slice(0, targetChars);
};

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const bench = async (): Promise<void> => {
  const text = buildPayload();
  const msPerChar = 1000 / Math.max(rate, 1);
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const cpuStart = process.cpuUsage();
  const eluStart = performance.eventLoopUtilization();

  let ipcEvents = 0;
  let ipcBytes = 0;
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const translator = createPiTranslatorState();
  translatePiSessionEventToUiChunks({ type: 'turn_start' }, translator);
  const messageId = 'bench-message';

  const emit = (payload: Parameters<typeof sequencer.next>[0]): void => {
    const event = sequencer.next(payload);
    ipcEvents += 1;
    ipcBytes += v8.serialize(event).byteLength;
  };

  if (variant === 'fullsnapshot') {
    let cursor = 0;
    while (cursor < text.length) {
      const end = Math.min(text.length, cursor + 8);
      cursor = end;
      emit({
        type: PiUiEventType.MessageUpdate,
        sessionId: 'bench',
        messageId,
        content: text.slice(0, cursor),
      });
      await delay(msPerChar * (end - (cursor - 8)));
    }
  } else {
    const coalescer = new UiMessageChunkCoalescer(({ sessionId, messageId: mid, chunk }) => {
      emit({ type: PiUiEventType.StreamPart, sessionId, messageId: mid, chunk });
    });
    for (let index = 0; index < text.length;) {
      const chunkSize = 1 + Math.floor(Math.random() * 8);
      const slice = text.slice(index, index + chunkSize);
      index += slice.length;
      for (const ch of slice) {
        for (const part of translatePiSessionEventToUiChunks(
          {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ch },
          },
          translator,
        )) {
          coalescer.push('bench', messageId, part);
        }
      }
      await delay(msPerChar * slice.length);
    }
    coalescer.flush();
  }

  histogram.disable();
  const cpuEnd = process.cpuUsage(cpuStart);
  const elu = performance.eventLoopUtilization(eluStart);

  const p99Ms = histogram.percentile(99) / 1e6;
  const p50Ms = histogram.percentile(50) / 1e6;

  console.log(
    JSON.stringify(
      {
        variant,
        sizeKey,
        rate,
        targetChars,
        ipcEvents,
        ipcBytes,
        ipcBytesPerChar: ipcBytes / targetChars,
        cpuUserMs: cpuEnd.user / 1000,
        cpuSystemMs: cpuEnd.system / 1000,
        eventLoopUtilization: elu.utilization,
        eventLoopDelayP50Ms: p50Ms,
        eventLoopDelayP99Ms: p99Ms,
      },
      null,
      2,
    ),
  );
};

void bench();
