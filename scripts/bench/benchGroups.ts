/**
 * Group runners for the streaming bench (review S1).
 *
 * A — main@aa288943 legacy path via fixtures/legacyMainPipeline.ts: the
 *     transcript accumulates full text per Pi update, throttles messageUpdate
 *     and SQLite writes at 200 ms (leading+trailing), then projects the full
 *     text through the prefix diff (timed separately as workerCpuMs) into
 *     ContentPatch chunks over IPC.
 * C — PR #1119 phase 1: real translator → real UiMessageChunkCoalescer →
 *     PiUiEventSequencer → IPC (JSON bytes counted). Renderer model: one
 *     mock-Redux dispatch of the accumulated text per rAF frame.
 * D — phase 1+2: the same main process plus real renderer pieces — LiveTextStore
 *     applying chunks on arrival and notifying on a virtual rAF; Redux written once at the
 *     terminal state. --render additionally mounts the jsdom + React.Profiler
 *     lower-bound component (renderHarness.ts).
 *
 * Every timer — Pi tokens, coalescer windows, 200 ms throttles, rAF frames —
 * runs on a VirtualClock; production classes that call global setTimeout /
 * Date.now / performance.now run inside installVirtualGlobals for the duration
 * of the scenario.
 */
import { randomUUID } from 'node:crypto';
import type { UIMessageChunk } from 'ai';

import {
  createPiTranslatorState,
  translatePiSessionEventToUiChunks,
} from '../../src/main/libs/agentEngine/piTranslate/piTranslateUiMessageChunk';
import { UiMessageChunkCoalescer } from '../../src/main/streaming/uiMessageChunkCoalescer';
import { PiUiEventSequencer, PiUiEventType } from '../../src/shared/cowork/piUiEvent';
import { LiveTextStore } from '../../src/renderer/services/liveTextStore';

import { LEGACY_THINKING_MESSAGE_ID, LegacyMainPipeline } from './fixtures/legacyMainPipeline';
import { createRenderHarness, type RenderHarness } from './renderHarness';
import {
  createVirtualRafScheduler,
  installVirtualGlobals,
  VirtualClock,
  type VirtualTimeoutHandle,
} from './virtualClock';
import {
  assembleResult,
  buildCorpus,
  combineLatency,
  createFeedPlan,
  createMockRedux,
  FRAME_MS,
  sizeToChars,
  startMeasure,
  StreamLatencyTracker,
  ThrottledSqliteCounter,
  type BenchSize,
  type FeedPlan,
  type ScenarioConfig,
  type ScenarioResult,
  type TokenKind,
} from './scenarioShared';

const SESSION_ID = 'bench-session';
const MESSAGE_ID = 'bench-message';

export interface BenchFlags {
  /** Mount the jsdom + React.Profiler lower-bound renderer for group D. */
  readonly render: boolean;
  /** Group A cap in chars; larger scenarios are truncated (truncatedFrom set). */
  readonly aMaxChars: number;
}

interface MainPipelineHooks {
  readonly onIpcEvent: (bytes: number) => void;
  readonly onStreamPart: (chunk: UIMessageChunk) => void;
}

interface MainPipeline {
  pushToken(kind: TokenKind, delta: string): void;
  flush(): void;
}

/** Real phase-1 main-process path: translator → coalescer → sequencer → IPC. */
const createIncrementalMainPipeline = (hooks: MainPipelineHooks): MainPipeline => {
  const sequencer = new PiUiEventSequencer(() => randomUUID());
  const translator = createPiTranslatorState();
  translatePiSessionEventToUiChunks({ type: 'turn_start' }, translator);
  const coalescer = new UiMessageChunkCoalescer(({ chunk }) => {
    const event = sequencer.next({
      type: PiUiEventType.StreamPart,
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      chunk,
    });
    hooks.onIpcEvent(Buffer.byteLength(JSON.stringify(event), 'utf8'));
    hooks.onStreamPart(chunk);
  });
  return {
    pushToken: (kind: TokenKind, delta: string): void => {
      const chunks = translatePiSessionEventToUiChunks(
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: kind === 'text' ? 'text_delta' : 'thinking_delta',
            contentIndex: kind === 'text' ? 0 : 1,
            delta,
          },
        },
        translator,
      );
      for (const chunk of chunks) coalescer.push(SESSION_ID, MESSAGE_ID, chunk);
    },
    flush: (): void => {
      coalescer.flush();
    },
  };
};

interface FeedHandlers {
  onToken(kind: TokenKind, delta: string, producedAt: number): void;
  onDone(): void;
}

/** Chains one virtual timer per token, then drains the whole virtual run. */
const runFeed = (clock: VirtualClock, plan: FeedPlan, handlers: FeedHandlers): void => {
  const step = (index: number): void => {
    if (index >= plan.tokenCount) {
      // Past the last token: leave room for the 200 ms trailing throttles and
      // the final rAF frame before finalizing.
      clock.setTimeout(() => handlers.onDone(), plan.intervalMs + 400);
      return;
    }
    clock.setTimeout(() => {
      const token = plan.tokenAt(index);
      handlers.onToken(token.kind, token.delta, clock.now());
      step(index + 1);
    }, plan.intervalMs);
  };
  step(0);
  clock.drain();
};

const noteIfDrainCapped = (clock: VirtualClock, notes: string[]): void => {
  if (clock.timerCount > 0) notes.push('drain stopped at the callback cap with timers pending');
};

// ── Group A: legacy main pipeline ──

const runLegacyScenario = (config: ScenarioConfig, flags: BenchFlags): ScenarioResult => {
  const requested = sizeToChars(config.size);
  const truncated = requested > flags.aMaxChars;
  const chars = truncated ? flags.aMaxChars : requested;
  const notes: string[] = [];
  if (truncated) {
    notes.push(
      `truncated from ${config.size} to ${chars} chars (--a-max-size=${flags.aMaxChars}): the legacy full-text prefix diff is O(content) per 200 ms emit`,
    );
  }
  const blocking: number[] = [];
  const clock = new VirtualClock({
    onCallbackDuration: realNs => {
      blocking.push(realNs / 1e6);
    },
  });
  const plan = createFeedPlan(buildCorpus(chars), config.rate, config.thinking);
  const textLatency = new StreamLatencyTracker();
  const reasoningLatency = new StreamLatencyTracker();
  let ipcEvents = 0;
  let ipcBytes = 0;
  let rendererCommits = 0;
  let lastFrameKey = -1;
  let visibleText = 0;
  let visibleReasoning = 0;
  const legacy = new LegacyMainPipeline({
    onPatch: patch => {
      ipcEvents += 1;
      // Legacy wire shape: ids + the patch itself (main had no sequencer envelope).
      ipcBytes += Buffer.byteLength(
        JSON.stringify({ sessionId: patch.sessionId, messageId: patch.messageId, patch }),
        'utf8',
      );
      const frameKey = Math.floor(clock.now() / FRAME_MS);
      if (frameKey !== lastFrameKey) {
        rendererCommits += 1;
        lastFrameKey = frameKey;
      }
      const visibleChars = patch.offset + patch.content.length;
      if (patch.messageId === LEGACY_THINKING_MESSAGE_ID) {
        visibleReasoning = Math.max(visibleReasoning, visibleChars);
        reasoningLatency.visible(visibleReasoning, clock.now());
      } else {
        visibleText = Math.max(visibleText, visibleChars);
        textLatency.visible(visibleText, clock.now());
      }
    },
  });
  const restore = installVirtualGlobals(clock);
  const measure = startMeasure();
  try {
    runFeed(clock, plan, {
      onToken: (kind, delta, producedAt) => {
        (kind === 'text' ? textLatency : reasoningLatency).produce(producedAt, delta.length);
        legacy.streamInto(kind === 'text' ? 'answer' : 'thinking', delta);
      },
      onDone: () => {
        legacy.finalize('answer');
        legacy.finalize('thinking');
      },
    });
    noteIfDrainCapped(clock, notes);
    notes.push('workerCpuMs (inline prefix diff) is included in mainCpuMs');
    return assembleResult({
      config,
      chars,
      truncatedFrom: truncated ? config.size : null,
      clock,
      blocking,
      ipcEvents,
      ipcBytes,
      workerCpuMs: legacy.workerCpuMs,
      sqliteWrites: legacy.sqliteWrites,
      rendererCommits,
      messageUpdateEmits: legacy.messageUpdateEmits,
      latency: combineLatency([textLatency, reasoningLatency]),
      measure,
      render: null,
      notes,
    });
  } finally {
    restore();
  }
};

// ── Group C: phase 1 ──

const runPhaseOneScenario = (config: ScenarioConfig): ScenarioResult => {
  const chars = sizeToChars(config.size);
  const blocking: number[] = [];
  const clock = new VirtualClock({
    onCallbackDuration: realNs => {
      blocking.push(realNs / 1e6);
    },
  });
  const plan = createFeedPlan(buildCorpus(chars), config.rate, config.thinking);
  const textLatency = new StreamLatencyTracker();
  const reasoningLatency = new StreamLatencyTracker();
  const redux = createMockRedux();
  const sqlite = new ThrottledSqliteCounter(clock);
  const pending: UIMessageChunk[] = [];
  let frameTimer: VirtualTimeoutHandle | undefined;
  let appliedText = 0;
  let appliedReasoning = 0;
  let visibleText = '';
  let ipcEvents = 0;
  let ipcBytes = 0;

  // Renderer model: batch everything that arrived since the last frame and
  // dispatch the accumulated text to mock Redux once per frame.
  const applyFrame = (): void => {
    frameTimer = undefined;
    if (pending.length === 0) return;
    const frameAt = clock.now();
    let frameText = '';
    for (const chunk of pending) {
      if (chunk.type === 'text-delta') {
        appliedText += chunk.delta.length;
        frameText += chunk.delta;
      } else if (chunk.type === 'reasoning-delta') {
        appliedReasoning += chunk.delta.length;
        frameText += chunk.delta;
      }
    }
    pending.length = 0;
    textLatency.visible(appliedText, frameAt);
    reasoningLatency.visible(appliedReasoning, frameAt);
    visibleText += frameText;
    redux.dispatch(visibleText);
  };

  const scheduleFrame = (): void => {
    if (frameTimer !== undefined) return;
    const dueAt = Math.floor(clock.now() / FRAME_MS) * FRAME_MS + FRAME_MS;
    frameTimer = clock.setTimeout(applyFrame, dueAt - clock.now());
  };

  const pipeline = createIncrementalMainPipeline({
    onIpcEvent: bytes => {
      ipcEvents += 1;
      ipcBytes += bytes;
    },
    onStreamPart: chunk => {
      pending.push(chunk);
      scheduleFrame();
    },
  });

  const restore = installVirtualGlobals(clock);
  const measure = startMeasure();
  try {
    runFeed(clock, plan, {
      onToken: (kind, delta, producedAt) => {
        (kind === 'text' ? textLatency : reasoningLatency).produce(producedAt, delta.length);
        sqlite.onDelta();
        pipeline.pushToken(kind, delta);
      },
      onDone: () => {
        pipeline.flush();
        sqlite.flushFinal();
      },
    });
    const notes = [
      'renderer model: one mock-Redux dispatch per rAF frame carrying the accumulated text (phase-1 shape)',
      'main process and renderer model share one process; mainCpuMs covers both',
    ];
    noteIfDrainCapped(clock, notes);
    return assembleResult({
      config,
      chars,
      truncatedFrom: null,
      clock,
      blocking,
      ipcEvents,
      ipcBytes,
      workerCpuMs: null,
      sqliteWrites: sqlite.writeCount,
      rendererCommits: redux.commits,
      messageUpdateEmits: null,
      latency: combineLatency([textLatency, reasoningLatency]),
      measure,
      render: null,
      notes,
    });
  } finally {
    restore();
  }
};

// ── Group D: phase 1+2 ──

const runPhaseTwoScenario = async (
  config: ScenarioConfig,
  flags: BenchFlags,
): Promise<ScenarioResult> => {
  const chars = sizeToChars(config.size);
  const blocking: number[] = [];
  const clock = new VirtualClock({
    onCallbackDuration: realNs => {
      blocking.push(realNs / 1e6);
    },
  });
  const plan = createFeedPlan(buildCorpus(chars), config.rate, config.thinking);
  const scheduler = createVirtualRafScheduler(clock, FRAME_MS);
  const store = new LiveTextStore({
    schedule: callback => {
      scheduler.request(callback);
    },
  });
  const textLatency = new StreamLatencyTracker();
  const reasoningLatency = new StreamLatencyTracker();
  const sqlite = new ThrottledSqliteCounter(clock);
  const redux = createMockRedux();
  let appliedText = 0;
  let appliedReasoning = 0;
  let rendererCommits = 0;
  let ipcEvents = 0;
  let ipcBytes = 0;
  const notes: string[] = [];

  let harness: RenderHarness | null = null;
  if (flags.render) {
    // Mounted on real timers before the virtual globals replace the clocks.
    harness = await createRenderHarness(store, MESSAGE_ID);
    notes.push(
      'renderer lower bound: jsdom <pre> subscriber via useSyncExternalStore; StreamingMarkdownResponse and Playwright frame tracking are deferred',
    );
  }
  if (config.thinking && config.size === '2mb') {
    notes.push(
      'interleaved thinking+text at 2mb stresses LiveTextStore interleaved-part rebuilds (quadratic); expect high maxBlockingMs',
    );
  }

  const unsubscribe = store.subscribe(() => {
    const frameAt = clock.now();
    textLatency.visible(appliedText, frameAt);
    reasoningLatency.visible(appliedReasoning, frameAt);
    rendererCommits += 1;
    if (harness !== null) harness.flush();
  });

  const pipeline = createIncrementalMainPipeline({
    onIpcEvent: bytes => {
      ipcEvents += 1;
      ipcBytes += bytes;
    },
    onStreamPart: chunk => {
      store.applyChunk(MESSAGE_ID, chunk, SESSION_ID);
      if (chunk.type === 'text-delta') appliedText += chunk.delta.length;
      else if (chunk.type === 'reasoning-delta') appliedReasoning += chunk.delta.length;
    },
  });

  const restore = installVirtualGlobals(clock);
  const measure = startMeasure();
  try {
    runFeed(clock, plan, {
      onToken: (kind, delta, producedAt) => {
        (kind === 'text' ? textLatency : reasoningLatency).produce(producedAt, delta.length);
        sqlite.onDelta();
        pipeline.pushToken(kind, delta);
      },
      onDone: () => {
        pipeline.flush();
        sqlite.flushFinal();
      },
    });
    // Phase 2: live text lives outside Redux and is written exactly once at
    // the terminal state (not counted in rendererCommits).
    redux.dispatch(store.getSnapshot(MESSAGE_ID) ?? '');
    notes.push('main process and renderer share one process; mainCpuMs covers both');
    noteIfDrainCapped(clock, notes);
    return assembleResult({
      config,
      chars,
      truncatedFrom: null,
      clock,
      blocking,
      ipcEvents,
      ipcBytes,
      workerCpuMs: null,
      sqliteWrites: sqlite.writeCount,
      rendererCommits,
      messageUpdateEmits: null,
      latency: combineLatency([textLatency, reasoningLatency]),
      measure,
      render: harness === null ? null : harness.collect(),
      notes,
    });
  } finally {
    unsubscribe();
    restore();
    if (harness !== null) harness.dispose();
  }
};

export const runScenario = async (
  config: ScenarioConfig,
  flags: BenchFlags,
): Promise<ScenarioResult> => {
  if (config.group === 'A') return runLegacyScenario(config, flags);
  if (config.group === 'C') return runPhaseOneScenario(config);
  return runPhaseTwoScenario(config, flags);
};
