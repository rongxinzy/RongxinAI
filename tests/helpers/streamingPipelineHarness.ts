/**
 * End-to-end harness for the Cowork streaming pipeline (PR #1119 guard/consistency tests).
 *
 * Assembles the REAL production chain and lets tests drive only the edges:
 *
 *   Pi AgentSession events (mock SDK, via piRuntimeAdapter.testHarness)
 *     → PiRuntimeAdapter (real)
 *     → forwardPiWorkbenchRuntimeToRenderer (real: coalescer → sequencer → webContents.send)
 *     → intercepted `CoworkStreamIpc.UiEvent` IPC (recorded + optionally lossy/reordered)
 *     → createCoworkStreamPipeline (real: sequence tracker → rAF batchers)
 *     → real LiveTextStore + real Redux store (coworkReducer)
 *
 * IMPORTANT — import order: test files MUST import
 * `'../src/main/libs/agentEngine/piRuntimeAdapter.testHarness'` BEFORE importing
 * this helper (that module registers the Pi SDK mocks and owns the adapter
 * lifecycle via `setupPiRuntimeAdapterSuite()`, which test files call inside
 * their `describe`). This file also imports it as its first import defensively.
 *
 * Exported API (details on each symbol below):
 *
 * - `createStreamingHarness(options): Promise<StreamingHarness>`
 *     `options: { sessionId: string; prompt?: string; delivery?: DeliveryControls | null }`
 *     Installs fake timers (`setTimeout/clearTimeout/setInterval/clearInterval/
 *     setImmediate/Date/performance`), intercepts `BrowserWindow.getAllWindows`
 *     and `ipcMain.handle`, binds the real forwarder to the suite `adapter`
 *     (memoized per adapter instance), subscribes the mock AgentSession, runs
 *     `await adapter.startSession(sessionId, prompt ?? 'Hi')`, and builds the
 *     renderer side (store + LiveTextStore + pipeline + manual rAF scheduler).
 *
 * - class `StreamingHarness`:
 *     - `emitPi(event: unknown): void` — feed one raw Pi event to the adapter listener.
 *     - `emitBatch(events, tickMs = 16): void` — emit all, then `tick`, then `runFrames`.
 *     - `emitStepped(events, tickMs = 1): void` — emit each event with a per-event tick.
 *     - `tick(ms = 16): void` — `vi.advanceTimersByTime(ms)` (fires the 16ms coalescer).
 *     - `runFrames(): void` — drain every queued rAF callback (multiple rounds).
 *     - `onFrame(cb: (frameIndex: number) => void): () => void` — called after each
 *       `runFrames()` invocation; use for per-frame invariants.
 *     - `flushDeliveries(): void` — deliver everything already sent (resolves a parked
 *       last-event swap); end-of-turn helper.
 *     - `settle(): void` — tick(64) + flushDeliveries + tick(8) + flushDeliveries +
 *       pipeline.flush() + runFrames(). Use before final assertions.
 *     - `displayed(messageId): string | undefined` — AssistantBubble rule:
 *       `metadata.isStreaming ? (live.getSnapshot(id) ?? content) : content`;
 *       `undefined` when the message is not in Redux yet.
 *     - `message(id)`, `currentMessages()`, `answerMessageIds()`,
 *       `thinkingMessageIds()`, `messageIdsOfType(...types)` — Redux accessors.
 *     - `ipcEvents: PiUiEvent[]` — every UiEvent payload sent to webContents, in order.
 *     - `sessionIpcEvents()`, `ipcEventsOfType(type)`, `streamPartIpcEvents()`,
 *       `textDeltaIpcEvents(messageId?)` — filtered views for budget/guard assertions.
 *     - `messageUpdateBusCount(): number` — how many `messageUpdate` events the
 *       adapter actually emitted (proves the runtime bus was active).
 *     - `setDeliveryControls(controls | null): void` — change interception mid-flight.
 *     - `undeliveredCount(): number` — sent-but-not-yet-delivered (or dropped) count.
 *     - `stats: StreamingHarnessStats` — delivered/dropped/duplicated/swapped/
 *       sequenceGaps/contentGaps/resyncRequests/unknownSessions counters.
 *     - `handlers: ReadonlyMap<string, IpcHandler>` — handlers captured from
 *       `ipcMain.handle` (includes RuntimeSnapshots/UiEventReplay and, after the
 *       fix, StreamResync).
 *     - `pipeline`, `live`, `store`, `sessionId`, `dispose()`.
 *
 * - interface `DeliveryControls` (index = position in `harness.ipcEvents`):
 *     - `dropWhen?(index, event): boolean` — do not deliver to the pipeline (IPC loss).
 *     - `duplicateWhen?(index, event): boolean` — deliver twice (IPC duplicate).
 *     - `swapWithNextWhen?(index, event): boolean` — deliver the NEXT event first,
 *       then this one (adjacent reorder; pairs are non-overlapping; a swap whose
 *       partner has not been sent yet parks this event until the partner arrives,
 *       or until `flushDeliveries()`).
 *     - `onDelivered?(index, event): void` — after each delivery to the pipeline.
 *
 * - `mulberry32(seed): () => number` — deterministic PRNG in [0, 1).
 * - `splitIntoDeltas(text, minPoints, maxPoints, random): string[]` — random split that
 *   never cuts a surrogate pair (splits on code-point boundaries).
 * - `buildCorpus(lengthInCodePoints, random): string` — mixed CJK/emoji/latin corpus.
 * - class `PiTurnBuilder` — builds Pi events carrying CUMULATIVE content blocks
 *   (matching real embedded AgentSession snapshots).
 * - `buildTextTurn(options): BuiltTurn` — single text part, randomly split deltas.
 * - `buildInterleavedThinkingTurn(options): BuiltTurn` — text(ci 0) → thinking(ci 1) →
 *   text(ci 2) inside ONE assistant message (drives part-ordering behavior).
 *
 * Delivery model: every `webContents.send(UiEvent, …)` is recorded in `ipcEvents`
 * and delivered to `pipeline.handleUiEvent` through a NON-REENTRANT queue.
 * `requestStreamResync` mirrors `ipcRenderer.invoke`: the main-process handler
 * runs in a later (fake-timer) task, never inside the main-process call stack
 * that emitted the event which revealed the gap, and its promise settles after
 * the handler has pushed the base snapshots. **禁止** letting resync snapshots
 * re-enter the pipeline (or the main process) synchronously.
 */

// IMPORTANT: keep this import first — it registers the Pi SDK mocks before any
// production module that transitively loads them is evaluated.
import { adapter, mockSession } from '../../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';

import { BrowserWindow, ipcMain } from 'electron';
import { configureStore } from '@reduxjs/toolkit';
import type { UnknownAction } from '@reduxjs/toolkit';
import { vi } from 'vitest';

import { forwardPiWorkbenchRuntimeToRenderer } from '../../src/main/appBootstrap/piUiForwarder';
import type { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { CoworkStreamIpc } from '../../src/shared/ipc/channels';
import { PiUiEventType } from '../../src/shared/cowork/piUiEvent';
import type { PiUiEvent } from '../../src/shared/cowork/piUiEvent';
import { createCoworkStreamPipeline } from '../../src/renderer/services/coworkStreamPipeline';
import type {
  CoworkStreamPipeline,
  CoworkStreamPipelineDeps,
} from '../../src/renderer/services/coworkStreamPipeline';
import { LiveTextStore } from '../../src/renderer/services/liveTextStore';
import coworkReducer, { setCurrentSession } from '../../src/renderer/store/slices/coworkSlice';
import type { CoworkMessage, CoworkSession } from '../../src/renderer/types/cowork';
import type { CoworkStore } from '../../src/main/coworkStore';
import {
  createHarnessCoworkStore,
  ensureHarnessCoworkSession,
  type HarnessCoworkStoreHandle,
} from './harnessCoworkStore';

export { PiUiEventType };
export type { PiUiEvent };

// ─── Deterministic randomness ────────────────────────────────────────────────

export * from './piTurnBuilders';

/**
 * rAF queue the tests drive by hand. `request` enqueues (returning a handle),
 * `cancel` removes, `drain` executes everything currently queued (callbacks may
 * schedule more frames; drained in bounded rounds).
 *
 * `request` is typed with an `unknown` callback parameter so it is structurally
 * assignable to the production `AnimationFrameScheduler` regardless of whether
 * that type passes a timestamp to callbacks.
 */
class ManualFrameQueue {
  private nextHandle = 1;
  private readonly pending = new Map<number, (time?: number) => void>();

  public readonly request = (callback: unknown): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.pending.set(handle, callback as (time?: number) => void);
    return handle;
  };

  public readonly cancel = (handle: number): void => {
    this.pending.delete(handle);
  };

  public drain(limit = 64): void {
    let rounds = 0;
    while (this.pending.size > 0 && rounds < limit) {
      const callbacks = [...this.pending.values()];
      this.pending.clear();
      for (const callback of callbacks) callback(rounds);
      rounds += 1;
    }
  }
}

// ─── Electron interception + adapter-scoped module state ─────────────────────

export type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

interface FakeStreamWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

const ipcHandlers = new Map<string, IpcHandler>();
let activeWindows: FakeStreamWindow[] = [];
let electronInterceptionInstalled = false;
let fakeTimersInstalled = false;
const forwardersByRuntime = new WeakMap<object, true>();
const messageUpdateCounters = new WeakMap<object, { count: number }>();

// StreamResync is added to CoworkStreamIpc by the fix; read it through a record
// cast so this file compiles and runs both before and after the fix.
const streamResyncChannel: string | undefined = (CoworkStreamIpc as Record<string, string>)
  .StreamResync;

function installFakeTimersOnce(): void {
  if (fakeTimersInstalled) return;
  fakeTimersInstalled = true;
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'Date',
      'performance',
    ],
  });
}

function installElectronInterception(): void {
  if (electronInterceptionInstalled) return;
  electronInterceptionInstalled = true;
  // The window list is indirection so each harness swaps its fake window in
  // without re-spying (repeat spyOn on the same property is fragile).
  vi.spyOn(BrowserWindow, 'getAllWindows').mockImplementation(() => activeWindows as never);
  vi.spyOn(ipcMain, 'handle').mockImplementation(((channel: unknown, handler: unknown) => {
    if (typeof channel === 'string' && typeof handler === 'function') {
      ipcHandlers.set(channel, handler as IpcHandler);
    }
  }) as unknown as () => void);
}

/**
 * Bind the real forwarder once per adapter instance. Seeds within one test share
 * the adapter, so the forwarder (and its coalescer) is bound exactly once — same
 * as production, which binds at bootstrap. The listenerCount check self-heals if
 * something stripped the adapter's listeners between tests.
 */
function ensureForwarderBound(runtime: object): void {
  const listenerCount = (
    runtime as { listenerCount?: (eventName: string) => number }
  ).listenerCount?.('uiStreamChunk');
  if (forwardersByRuntime.has(runtime) && (listenerCount ?? 0) > 0) return;
  forwardPiWorkbenchRuntimeToRenderer(runtime as PiRuntimeAdapter);
  forwardersByRuntime.set(runtime, true);
}

/** One shared 'messageUpdate' counter per adapter (no listener accumulation). */
function messageUpdateCounterFor(runtime: object): { count: number } {
  const existing = messageUpdateCounters.get(runtime);
  if (existing) return existing;
  const counter = { count: 0 };
  messageUpdateCounters.set(runtime, counter);
  (runtime as { on?: (eventName: string, listener: () => void) => unknown }).on?.(
    'messageUpdate',
    () => {
      counter.count += 1;
    },
  );
  return counter;
}

function buildHarnessSession(sessionId: string): CoworkSession {
  const now = Date.now();
  const session = {
    id: sessionId,
    title: 'streaming harness session',
    status: 'idle',
    mode: 'work',
    pinned: false,
    pinOrder: 0,
    cwd: process.cwd(),
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'work',
    activeSkillIds: [],
    workspaceId: 'streaming-harness',
    agentId: 'streaming-harness-agent',
    source: 'local',
    messages: [],
    messagesOffset: 0,
    totalMessages: 0,
    createdAt: now,
    updatedAt: now,
  };
  // Enum-ish fields (status/executionMode/source) are owned by the cowork domain
  // types; cast through unknown so this helper stays compile-safe without
  // hard-coding those unions here.
  return session as unknown as CoworkSession;
}

const createHarnessStore = () => configureStore({ reducer: { cowork: coworkReducer } });

/** Redux store type used by the harness (real coworkReducer). */
export type StreamingHarnessStore = ReturnType<typeof createHarnessStore>;

export interface StreamingHarnessStats {
  /** pipeline.handleUiEvent invocations (duplicates count twice). */
  delivered: number;
  dropped: number;
  duplicated: number;
  swapped: number;
  /** Renderer-side sequence gap detections (pipeline onSequenceGap). */
  sequenceGaps: number;
  /** Content-buffer gap detections (pipeline onContentGap). */
  contentGaps: number;
  /** requestStreamResync invocations (including no-op ones pre-fix). */
  resyncRequests: number;
  unknownSessions: number;
}

export interface DeliveryControls {
  dropWhen?(index: number, event: PiUiEvent): boolean;
  duplicateWhen?(index: number, event: PiUiEvent): boolean;
  swapWithNextWhen?(index: number, event: PiUiEvent): boolean;
  onDelivered?(index: number, event: PiUiEvent): void;
}

export interface CreateStreamingHarnessOptions {
  sessionId: string;
  /** Prompt passed to adapter.startSession; default 'Hi'. */
  prompt?: string;
  delivery?: DeliveryControls | null;
  /** When true, binds a real in-memory CoworkStore (for DB assertions). */
  useSqliteStore?: boolean;
}

export class StreamingHarness {
  public readonly sessionId: string;
  public readonly store: StreamingHarnessStore;
  public readonly pipeline: CoworkStreamPipeline;
  public readonly live: LiveTextStore = new LiveTextStore();
  /** Every UiEvent payload sent to webContents, in send order. */
  public readonly ipcEvents: PiUiEvent[] = [];
  public readonly handlers: ReadonlyMap<string, IpcHandler> = ipcHandlers;
  public readonly stats: StreamingHarnessStats = {
    delivered: 0,
    dropped: 0,
    duplicated: 0,
    swapped: 0,
    sequenceGaps: 0,
    contentGaps: 0,
    resyncRequests: 0,
    unknownSessions: 0,
  };

  private readonly prompt: string;
  private readonly frames = new ManualFrameQueue();
  private readonly fakeWindow: FakeStreamWindow;
  private readonly frameListeners = new Set<(frameIndex: number) => void>();
  private piListener: ((event: unknown) => void) | null = null;
  private messageUpdateCounter: { count: number } | null = null;
  private deliveryControls: DeliveryControls | null;
  private readonly settledIndices = new Set<number>();
  private deliveryCursor = 0;
  private pumping = false;
  private frameIndex = 0;
  private disposed = false;
  private coworkStoreHandle: HarnessCoworkStoreHandle | null = null;
  private readonly useSqliteStore: boolean;

  /** @internal — use createStreamingHarness(). */
  constructor(options: CreateStreamingHarnessOptions) {
    this.sessionId = options.sessionId;
    this.prompt = options.prompt ?? 'Hi';
    this.deliveryControls = options.delivery ?? null;
    this.useSqliteStore = options.useSqliteStore === true;

    this.store = createHarnessStore();
    this.store.dispatch(setCurrentSession(buildHarnessSession(options.sessionId)));

    // The fixed pipeline adds an optional `requestStreamResync` dep. Declare the
    // deps object through an intersection so this compiles both before and after
    // the fix (a fresh object literal with the extra key would fail excess
    // property checks against the current interface).
    const pipelineDeps: CoworkStreamPipelineDeps & {
      requestStreamResync?: (sessionId: string) => void;
    } = {
      dispatch: (action: UnknownAction) => this.store.dispatch(action),
      getCoworkState: () => this.store.getState().cowork,
      liveText: this.live,
      scheduler: this.frames,
      shouldApply: () => true,
      // Production wires these to session recovery (reload from the DB), not
      // to the stream resync; the pipeline itself requests the resync.
      onSequenceGap: () => {
        this.stats.sequenceGaps += 1;
      },
      onContentGap: () => {
        this.stats.contentGaps += 1;
      },
      onUnknownSession: () => {
        this.stats.unknownSessions += 1;
      },
      requestStreamResync: sessionId => this.requestStreamResync(sessionId),
    };
    this.pipeline = createCoworkStreamPipeline(pipelineDeps);

    this.fakeWindow = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, ...args: unknown[]) => {
          this.onWindowSend(channel, args[0]);
        },
      },
    };
    activeWindows = [this.fakeWindow];
  }

  /** @internal — invoked by createStreamingHarness after construction. */
  async start(): Promise<void> {
    ensureForwarderBound(adapter);
    if (this.useSqliteStore) {
      this.coworkStoreHandle = createHarnessCoworkStore();
      ensureHarnessCoworkSession(this.coworkStoreHandle.store, this.sessionId, 'chat');
      adapter.setCoworkStore(this.coworkStoreHandle.store);
    }
    this.messageUpdateCounter = messageUpdateCounterFor(adapter);
    mockSession.subscribe.mockImplementation((callback: (event: unknown) => void) => {
      this.piListener = callback;
      return () => {};
    });
    await adapter.startSession(this.sessionId, this.prompt);
    if (!this.piListener) {
      throw new Error(
        'PiRuntimeAdapter did not subscribe to the mock AgentSession during startSession',
      );
    }
  }

  // ── driving ────────────────────────────────────────────────────────────────

  /** Feed one raw Pi AgentSession event to the captured adapter listener. */
  emitPi(event: unknown): void {
    if (!this.piListener) {
      throw new Error('No Pi listener captured; await createStreamingHarness() first.');
    }
    this.piListener(event);
  }

  /** Emit all events, then tick once (coalescer flush), then runFrames(). */
  emitBatch(events: readonly unknown[], tickMs = 16): void {
    for (const event of events) this.emitPi(event);
    this.tick(tickMs);
    this.runFrames();
  }

  /** Emit each event followed by a small tick (per-delta coalescer cadence). */
  emitStepped(events: readonly unknown[], tickMs = 1): void {
    for (const event of events) {
      this.emitPi(event);
      this.tick(tickMs);
    }
  }

  /** Advance fake timers (16ms = one coalescer window by default). */
  tick(ms = 16): void {
    vi.advanceTimersByTime(ms);
  }

  /** Drain every queued rAF callback, then notify onFrame subscribers. */
  runFrames(): void {
    this.frames.drain();
    this.frameIndex += 1;
    for (const listener of [...this.frameListeners]) listener(this.frameIndex);
  }

  /** Register a callback invoked after every runFrames() invocation. */
  onFrame(listener: (frameIndex: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /**
   * Deliver everything already sent, resolving a parked swap pairing without the
   * reorder (end-of-turn helper so a parked last event cannot stall the stream).
   */
  flushDeliveries(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.deliveryCursor < this.ipcEvents.length) {
        const index = this.deliveryCursor;
        if (this.settledIndices.has(index)) {
          this.deliveryCursor += 1;
          continue;
        }
        const event = this.ipcEvents[index];
        if (!event) {
          this.deliveryCursor += 1;
          continue;
        }
        if (this.invokeControl(this.deliveryControls?.dropWhen, index, event)) {
          this.stats.dropped += 1;
        } else {
          this.deliverCore(index, event);
        }
        this.settledIndices.add(index);
        this.deliveryCursor += 1;
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Flush timers + pending deliveries + pipeline batchers + frames. */
  settle(): void {
    this.tick(64);
    this.flushDeliveries();
    this.tick(8);
    this.flushDeliveries();
    this.pipeline.flush();
    this.runFrames();
  }

  /** Replace the delivery interception rules; pending events pick them up. */
  setDeliveryControls(controls: DeliveryControls | null): void {
    this.deliveryControls = controls;
    this.pump();
  }

  /** Sent events not yet settled (delivered, dropped or parked). */
  undeliveredCount(): number {
    return this.ipcEvents.length - this.settledIndices.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameListeners.clear();
    this.pipeline.dispose();
    this.coworkStoreHandle?.cleanup();
    this.coworkStoreHandle = null;
    if (activeWindows[0] === this.fakeWindow) {
      activeWindows = [];
    }
  }

  /** Messages persisted in the SQLite CoworkStore for this session. */
  dbMessages(): CoworkMessage[] {
    const store = this.coworkStoreHandle?.store;
    if (!store) return [];
    return store.getSession(this.sessionId, null, { includeArtifacts: false })?.messages ?? [];
  }

  coworkStore(): CoworkStore | null {
    return this.coworkStoreHandle?.store ?? null;
  }

  // ── renderer observations ──────────────────────────────────────────────────

  /**
   * AssistantBubble display rule:
   * `metadata.isStreaming ? (live.getSnapshot(id) ?? content) : content`.
   * Returns undefined while the message is not in Redux yet.
   */
  displayed(messageId: string): string | undefined {
    const message = this.message(messageId);
    if (!message) return undefined;
    if (message.metadata?.isStreaming) {
      return this.live.getSnapshot(messageId) ?? message.content;
    }
    return message.content;
  }

  message(messageId: string): CoworkMessage | undefined {
    return this.currentMessages().find(candidate => candidate.id === messageId);
  }

  /** Messages of the current session (the only Redux slot that holds bodies). */
  currentMessages(): CoworkMessage[] {
    return this.store.getState().cowork.currentSession?.messages ?? [];
  }

  /** Assistant answer bubbles: type 'assistant' without metadata.isThinking. */
  answerMessageIds(): string[] {
    return this.currentMessages()
      .filter(message => message.type === 'assistant' && !message.metadata?.isThinking)
      .map(message => message.id);
  }

  /** Reasoning bubbles: type 'assistant' with metadata.isThinking (see piAssistantTranscript). */
  thinkingMessageIds(): string[] {
    return this.currentMessages()
      .filter(message => message.type === 'assistant' && Boolean(message.metadata?.isThinking))
      .map(message => message.id);
  }

  messageIdsOfType(...types: string[]): string[] {
    return this.currentMessages()
      .filter(message => types.includes(message.type))
      .map(message => message.id);
  }

  /** UiEvents addressed to THIS harness session (cross-session noise removed). */
  sessionIpcEvents(): PiUiEvent[] {
    return this.ipcEvents.filter(
      event => (event as { sessionId?: unknown }).sessionId === this.sessionId,
    );
  }

  ipcEventsOfType(type: string): PiUiEvent[] {
    return this.ipcEvents.filter(event => event.type === type);
  }

  streamPartIpcEvents(): PiUiEvent[] {
    return this.ipcEventsOfType(PiUiEventType.StreamPart);
  }

  /** StreamPart events whose chunk is a text-delta, optionally per message. */
  textDeltaIpcEvents(messageId?: string): PiUiEvent[] {
    return this.streamPartIpcEvents().filter(event => {
      const record = event as { messageId?: unknown; chunk?: { type?: unknown } };
      if (messageId !== undefined && record.messageId !== messageId) return false;
      return record.chunk?.type === 'text-delta';
    });
  }

  /** How many messageUpdate events the adapter actually emitted on its bus. */
  messageUpdateBusCount(): number {
    return this.messageUpdateCounter?.count ?? 0;
  }

  // ── delivery engine (queued, non-reentrant) ────────────────────────────────

  private onWindowSend(channel: string, payload: unknown): void {
    if (this.disposed) return;
    if (channel !== CoworkStreamIpc.UiEvent) return;
    this.ipcEvents.push(payload as PiUiEvent);
    this.pump();
  }

  /**
   * Deliver sent events to the pipeline in ipcEvents order, applying
   * drop/duplicate/swap controls. NON-REENTRANT: if a delivery synchronously
   * triggers requestStreamResync whose handler sends a resync snapshot, that
   * send lands in ipcEvents while `pumping` is true; this loop then picks it up
   * AFTER the in-flight delivery finishes (loop condition re-reads
   * ipcEvents.length). A synchronous re-entry would apply a snapshot on top of a
   * half-applied delta and duplicate content.
   */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.deliveryCursor < this.ipcEvents.length) {
        const index = this.deliveryCursor;
        if (this.settledIndices.has(index)) {
          this.deliveryCursor += 1;
          continue;
        }
        const event = this.ipcEvents[index];
        if (!event) {
          this.deliveryCursor += 1;
          continue;
        }
        if (this.invokeControl(this.deliveryControls?.dropWhen, index, event)) {
          this.settledIndices.add(index);
          this.stats.dropped += 1;
          this.deliveryCursor += 1;
          continue;
        }
        if (this.invokeControl(this.deliveryControls?.swapWithNextWhen, index, event)) {
          if (this.settledIndices.has(index + 1)) {
            // Partner already consumed by an earlier pair: deliver in order.
            this.settledIndices.add(index);
            this.deliverCore(index, event);
            this.deliveryCursor += 1;
            continue;
          }
          const partner = index + 1 < this.ipcEvents.length ? this.ipcEvents[index + 1] : undefined;
          if (!partner) break; // partner not sent yet: park until it arrives (or flushDeliveries)
          this.settledIndices.add(index);
          this.settledIndices.add(index + 1);
          this.stats.swapped += 1;
          if (!this.invokeControl(this.deliveryControls?.dropWhen, index + 1, partner)) {
            this.deliverCore(index + 1, partner);
          } else {
            this.stats.dropped += 1;
          }
          this.deliverCore(index, event);
          this.deliveryCursor = index + 2;
          continue;
        }
        this.settledIndices.add(index);
        this.deliverCore(index, event);
        this.deliveryCursor += 1;
      }
    } finally {
      this.pumping = false;
    }
  }

  private deliverCore(index: number, event: PiUiEvent): void {
    this.pipeline.handleUiEvent(event);
    this.stats.delivered += 1;
    this.deliveryControls?.onDelivered?.(index, event);
    if (this.invokeControl(this.deliveryControls?.duplicateWhen, index, event)) {
      this.pipeline.handleUiEvent(event);
      this.stats.delivered += 1;
      this.stats.duplicated += 1;
    }
  }

  private invokeControl(
    control: ((index: number, event: PiUiEvent) => boolean) | undefined,
    index: number,
    event: PiUiEvent,
  ): boolean {
    return control?.(index, event) === true;
  }

  /**
   * Mirrors `ipcRenderer.invoke`: the main-process handler runs in a LATER task
   * (never inside the main-process call stack that emitted the event which
   * revealed the gap), and the returned promise settles after the handler has
   * pushed its snapshots through webContents.send.
   */
  private requestStreamResync(sessionId: string): Promise<unknown> {
    this.stats.resyncRequests += 1;
    return new Promise(resolve => {
      setTimeout(() => {
        const handler =
          typeof streamResyncChannel === 'string'
            ? this.handlers.get(streamResyncChannel)
            : undefined;
        resolve(handler ? handler({}, sessionId) : false);
      }, 0);
    });
  }
}

/**
 * Build a full streaming harness for `options.sessionId`:
 * fake timers + electron interception + real forwarder bound to the suite
 * adapter + `await adapter.startSession(...)` + real renderer pipeline.
 *
 * Must be called inside a test after `setupPiRuntimeAdapterSuite()` ran (its
 * beforeEach provides the fresh `adapter`/`mockSession` this harness drives).
 */
export async function createStreamingHarness(
  options: CreateStreamingHarnessOptions,
): Promise<StreamingHarness> {
  installFakeTimersOnce();
  installElectronInterception();
  // Drain any coalescer window a previous harness left pending on the shared
  // adapter before this harness starts recording (stale sends go to the old
  // window or to an empty window list, never to this harness).
  vi.advanceTimersByTime(256);
  const harness = new StreamingHarness(options);
  await harness.start();
  return harness;
}
