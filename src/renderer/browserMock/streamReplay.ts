import {
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import {
  PiUiEventType,
  type PiUiEvent,
  type PiUiEventPayload,
} from '../../shared/cowork/piUiEvent';
import type { CoworkMessage } from '../types/cowork';
import type { MockSession } from './fixtures';
import type { BrowserMockRuntime } from './runtime';

import glmFreshTrace from './fixtures/streamReplay/glm-fresh-pr1127-jsonl-gz.json';
import glmToolTextTrace from './fixtures/streamReplay/glm-tool-text-jsonl.json';
import retry503Trace from './fixtures/streamReplay/503-auto-retry.json';
import synthetic20kTrace from './fixtures/streamReplay/synthetic-20000.json';

const PreviewStreamReplayQuery = {
  Fixture: 'previewStreamReplay',
  AutoStart: 'previewStreamAutoStart',
  InstantBaseline: 'previewStreamReplayInstant',
  ScrollMutation: 'previewScrollMutation',
} as const;

/** Dev-only scroll sabotage for Playwright gate verification (browserMock only). */
export const PreviewScrollMutation = {
  NoTailFollow: 'no-tail-follow',
} as const;
export type PreviewScrollMutation =
  (typeof PreviewScrollMutation)[keyof typeof PreviewScrollMutation];

export function readPreviewScrollMutation(
  search = readBrowserSearchParam(),
): PreviewScrollMutation | null {
  const raw = new URLSearchParams(search).get(PreviewStreamReplayQuery.ScrollMutation)?.trim();
  if (raw === PreviewScrollMutation.NoTailFollow) return raw;
  return null;
}

export type StreamReplayFixtureId =
  | 'glm-tool-text-jsonl'
  | 'glm-fresh-pr1127-jsonl-gz'
  | '503-auto-retry'
  | 'synthetic-20000';

export interface StreamReplayTrace {
  readonly sessionId: string;
  readonly fixture: string;
  readonly expectedFinalText: string;
  readonly events: readonly { delayMs: number; event: PiUiEventPayload }[];
  readonly markers: {
    readonly thinkingBeforeAnswer: boolean;
    readonly toolBeforeAnswer: boolean;
    readonly toolNames: readonly string[];
  };
}

const TRACES: Record<StreamReplayFixtureId, StreamReplayTrace> = {
  'glm-tool-text-jsonl': glmToolTextTrace as StreamReplayTrace,
  'glm-fresh-pr1127-jsonl-gz': glmFreshTrace as StreamReplayTrace,
  '503-auto-retry': retry503Trace as StreamReplayTrace,
  'synthetic-20000': synthetic20kTrace as StreamReplayTrace,
};

function readBrowserSearchParam(): string {
  if (typeof window === 'undefined') return '';
  const search = window.location?.search;
  return typeof search === 'string' ? search : '';
}

export function readStreamReplayFixtureId(
  search = readBrowserSearchParam(),
): StreamReplayFixtureId | null {
  const raw = new URLSearchParams(search).get(PreviewStreamReplayQuery.Fixture)?.trim();
  if (!raw) return null;
  if (raw in TRACES) return raw as StreamReplayFixtureId;
  return null;
}

export function readPreviewStreamReplayInstant(search = readBrowserSearchParam()): boolean {
  const raw = new URLSearchParams(search)
    .get(PreviewStreamReplayQuery.InstantBaseline)
    ?.trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function shouldAutoStartStreamReplay(search = readBrowserSearchParam()): boolean {
  const raw = new URLSearchParams(search)
    .get(PreviewStreamReplayQuery.AutoStart)
    ?.trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function getStreamReplayTrace(id: StreamReplayFixtureId): StreamReplayTrace {
  return TRACES[id];
}

export interface StreamReplayController {
  readonly fixtureId: StreamReplayFixtureId;
  readonly trace: StreamReplayTrace;
  /** Real-time replay (setTimeout delays). For manual preview / smoke only. */
  begin(): void;
  /** Deterministic stepped replay for Playwright (no timers). */
  beginStepped(): void;
  /** Emit the next IPC event; returns false when the trace is finished. */
  step(): boolean;
  readonly status: 'idle' | 'streaming' | 'complete';
  readonly replayPhase: 'idle' | 'first' | 'retry' | 'complete';
  readonly replayStartedAt: number;
  readonly replayEndedAt: number;
  readonly eventsEmitted: number;
  readonly eventCount: number;
}

declare global {
  interface Window {
    __previewCoworkStreamReady?: boolean;
    __previewStreamReplay?: StreamReplayController & {
      samples: Array<{ at: number; text: string; answerBubbles: number }>;
      longTasks: Array<{ startTime: number; duration: number }>;
      replayPhase: 'idle' | 'first' | 'retry' | 'complete';
      replayStartedAt: number;
      replayEndedAt: number;
    };
  }
}

export function seedStreamReplaySession(trace: StreamReplayTrace): MockSession {
  let userMessage: CoworkMessage | undefined;
  for (const entry of trace.events) {
    const event = entry.event;
    if (event.type !== PiUiEventType.Message || !('message' in event)) continue;
    if (event.message?.type !== 'user') continue;
    userMessage = event.message as CoworkMessage;
    break;
  }
  const now = Date.UTC(2026, 10, 16, 8, 0, 0);
  return {
    id: trace.sessionId,
    title: `Stream replay (${trace.fixture})`,
    status: CoworkSessionStatus.Idle,
    pinned: false,
    cwd: '/home/user/projects/preview',
    systemPrompt: '',
    modelOverride: '',
    executionMode: CoworkExecutionMode.Auto,
    activeSkillIds: [],
    workspaceId: '',
    agentId: 'main',
    source: CoworkSessionSource.Manual,
    mode: CoworkSessionMode.Work,
    messages: userMessage
      ? [
          {
            id: userMessage.id,
            type: 'user',
            content: userMessage.content,
            timestamp: userMessage.timestamp ?? now,
          },
        ]
      : [],
    messagesOffset: 0,
    totalMessages: userMessage ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function seedStreamReplaySessionFullParse(trace: StreamReplayTrace): MockSession {
  const base = seedStreamReplaySession(trace);
  let assistantId: string | undefined;
  for (const entry of trace.events) {
    const event = entry.event;
    if (event.type !== PiUiEventType.Message || !('message' in event)) continue;
    if (event.message?.type !== 'assistant') continue;
    assistantId = event.message.id;
    break;
  }
  if (!assistantId) return base;
  const now = Date.UTC(2026, 10, 16, 8, 0, 0);
  return {
    ...base,
    status: CoworkSessionStatus.Completed,
    messages: [
      ...base.messages,
      {
        id: assistantId,
        type: 'assistant',
        content: trace.expectedFinalText,
        timestamp: now + 1000,
        metadata: { isStreaming: false, isFinal: true },
      },
    ],
    totalMessages: base.messages.length + 1,
    updatedAt: now + 1000,
  };
}

export function installStreamReplayController(options: {
  runtime: BrowserMockRuntime;
  fixtureId: StreamReplayFixtureId;
  emitRecorded: (payload: PiUiEvent) => void;
  getSession: () => MockSession | undefined;
  setSession: (session: MockSession) => void;
}): StreamReplayController {
  const trace = getStreamReplayTrace(options.fixtureId);
  let status: 'idle' | 'streaming' | 'complete' = 'idle';
  let replayPhase: 'idle' | 'first' | 'retry' | 'complete' = 'idle';
  let replayStartedAt = 0;
  let replayEndedAt = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let nextEventIndex = 0;
  const samples: Array<{ at: number; text: string; answerBubbles: number }> = [];
  const longTasks: Array<{ startTime: number; duration: number }> = [];

  const clearTimers = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };

  const sampleDom = (): void => {
    const answerNodes = [...document.querySelectorAll('.is-assistant .theme-message-body')];
    const last = answerNodes.at(-1);
    const text = (last as HTMLElement | undefined)?.innerText?.trim() ?? '';
    samples.push({ at: performance.now(), text, answerBubbles: answerNodes.length });
  };

  const applyStreamReopenPhase = (payload: PiUiEvent): void => {
    if (
      payload.type === 'message_update' &&
      'metadata' in payload &&
      payload.metadata &&
      typeof payload.metadata === 'object' &&
      (payload.metadata as { streamReopen?: boolean }).streamReopen === true
    ) {
      replayPhase = 'retry';
    }
  };

  const emitEventAtIndex = (index: number): void => {
    const entry = trace.events[index];
    if (!entry) return;
    const payload = entry.event as PiUiEvent;
    applyStreamReopenPhase(payload);
    options.emitRecorded(payload);
    sampleDom();
    if (index === trace.events.length - 1) {
      status = 'complete';
      replayPhase = 'complete';
      replayEndedAt = performance.now();
      const current = options.getSession();
      if (current) {
        options.setSession({
          ...current,
          status: CoworkSessionStatus.Completed,
          updatedAt: Date.now(),
        });
      }
      options.runtime.emit('preview.streamReplay.complete', { fixtureId: options.fixtureId });
    }
  };

  const resetReplayState = (): void => {
    clearTimers();
    nextEventIndex = 0;
    status = 'streaming';
    replayPhase = 'first';
    replayStartedAt = performance.now();
    replayEndedAt = 0;
    const session = options.getSession();
    if (session) {
      options.setSession({
        ...session,
        status: CoworkSessionStatus.Running,
        updatedAt: Date.now(),
      });
    }
  };

  const begin = (): void => {
    if (status !== 'idle') return;
    resetReplayState();
    let elapsed = 0;
    trace.events.forEach((entry, index) => {
      elapsed += Math.max(8, entry.delayMs);
      timers.push(
        setTimeout(() => {
          emitEventAtIndex(index);
        }, elapsed),
      );
    });
  };

  const beginStepped = (): void => {
    if (status !== 'idle') return;
    resetReplayState();
  };

  const step = (): boolean => {
    if (status !== 'streaming') return false;
    if (nextEventIndex >= trace.events.length) return false;
    emitEventAtIndex(nextEventIndex);
    nextEventIndex += 1;
    return status === 'streaming';
  };

  const controller: StreamReplayController = {
    fixtureId: options.fixtureId,
    trace,
    begin,
    beginStepped,
    step,
    get status() {
      return status;
    },
    get replayPhase() {
      return replayPhase;
    },
    get replayStartedAt() {
      return replayStartedAt;
    },
    get replayEndedAt() {
      return replayEndedAt;
    },
    get eventsEmitted() {
      return nextEventIndex;
    },
    get eventCount() {
      return trace.events.length;
    },
  };

  window.__previewStreamReplay = Object.assign(controller, { samples, longTasks });
  return controller;
}

export function installStreamReplayLongTaskObserver(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== 'longtask') continue;
        window.__previewStreamReplay?.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Long task observation is best-effort in older Chromium builds.
  }
}
