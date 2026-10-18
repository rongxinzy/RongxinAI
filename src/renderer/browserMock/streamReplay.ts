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
} as const;

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
  begin(): void;
  readonly status: 'idle' | 'streaming' | 'complete';
  readonly replayPhase: 'idle' | 'first' | 'retry' | 'complete';
  readonly replayStartedAt: number;
  readonly replayEndedAt: number;
}

declare global {
  interface Window {
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

  const begin = (): void => {
    if (status !== 'idle') return;
    status = 'streaming';
    replayPhase = 'first';
    replayStartedAt = performance.now();
    replayEndedAt = 0;
    clearTimers();
    const session = options.getSession();
    if (session) {
      options.setSession({
        ...session,
        status: CoworkSessionStatus.Running,
        updatedAt: Date.now(),
      });
    }
    let elapsed = 0;
    trace.events.forEach((entry, index) => {
      elapsed += Math.max(8, entry.delayMs);
      timers.push(
        setTimeout(() => {
          const payload = entry.event as PiUiEvent;
          if (
            payload.type === 'message_update' &&
            'metadata' in payload &&
            payload.metadata &&
            typeof payload.metadata === 'object' &&
            (payload.metadata as { streamReopen?: boolean }).streamReopen === true
          ) {
            replayPhase = 'retry';
          }
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
        }, elapsed),
      );
    });
  };

  const controller: StreamReplayController = {
    fixtureId: options.fixtureId,
    trace,
    begin,
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
