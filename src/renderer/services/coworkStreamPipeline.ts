/**
 * Cowork streaming — renderer-side Pi UI event pipeline.
 *
 * Extracted verbatim from CoworkService.setupStreamListeners so the whole
 * renderer streaming path (sequence tracker → recovery watermark → content
 * buffer → live text (immediate apply, rAF notify) → rAF-committed Redux
 * dispatch) can be driven end-to-end from node vitest without the global
 * store or `window`.
 *
 * Invariants: StreamPart events carry deltas only; full snapshots are limited
 * to ContentPatch base sync (metadata.isStreaming === true, complete patch),
 * the final MessageUpdate and terminal/error states. Duplicate terminal
 * emissions arrive as metadata-only MessageUpdates (empty content,
 * metadata.metadataOnly === true): they merge metadata alone and never touch
 * the committed body.
 * **禁止**把全文快照当作常规流式增量分发；非 final 的全文 MessageUpdate 在此丢弃（S6）。
 * Architecture: docs/architecture/streaming.md
 */
import type { UnknownAction } from '@reduxjs/toolkit';
import { CoworkPermissionOrigin } from '../../shared/cowork/constants';
import {
  PiUiEventSequenceTracker,
  PiUiEventType,
  type PiUiEvent,
} from '../../shared/cowork/piUiEvent';
import type { CoworkContentPatch } from '../../shared/cowork/runState';
import coworkReducer, {
  addMessage,
  clearPendingPermissionsForSession,
  dequeuePendingPermission,
  enqueuePendingPermission,
  updateMessageContents,
  removeMessage,
  updateSessionStatus,
  updateToolActivity,
} from '../store/slices/coworkSlice';
import { CoworkContentBuffer } from './coworkContentBuffer';
import {
  createCoworkTerminalErrorMessage,
  hasMatchingLatestTerminalError,
} from './coworkTerminalError';
import type { LiveTextStore } from './liveTextStore';
import {
  type AnimationFrameScheduler,
  browserAnimationFrameScheduler,
  RafMessageUpdateBatcher,
} from './rafMessageUpdateBatcher';

export type CoworkSliceState = ReturnType<typeof coworkReducer>;

export interface CoworkStreamPipelineDeps {
  dispatch: (action: UnknownAction) => unknown;
  getCoworkState: () => CoworkSliceState;
  liveText: LiveTextStore;
  /**
   * Ask the main process to re-emit base snapshots for a session's
   * still-streaming messages. Contract: the main process pushes those
   * snapshots (complete ContentPatch, isStreaming === true) into the event
   * stream BEFORE the returned value settles, so `endSessionResync` runs
   * after the snapshots were applied.
   */
  requestStreamResync?: (sessionId: string) => Promise<unknown> | unknown;
  /** Defaults to the browser animation-frame scheduler. */
  scheduler?: AnimationFrameScheduler;
  /** recovery.observe(event): true = apply, false = drop (lifecycle watermark). */
  shouldApply: (event: PiUiEvent) => boolean;
  /** What the service does on a sequence gap (runSync.requestRecovery + recovery.recover + logging). */
  onSequenceGap: (sessionId: string) => void;
  /** CoworkContentBuffer onGap (= runSync.requestRecovery). */
  onContentGap: (sessionId: string) => void;
  /** Refresh session lists when a Message event targets an unknown session. */
  onUnknownSession: (sessionId: string) => void;
}

export interface CoworkStreamPipeline {
  handleUiEvent(event: unknown): void;
  flush(): void;
  dispose(): void;
}

type BoundedIdSet = {
  has: (id: string) => boolean;
  add: (id: string) => void;
  delete: (id: string) => void;
};

/** Insertion-order FIFO id set with a hard cap so bookkeeping stays bounded. */
const createBoundedIdSet = (capacity: number): BoundedIdSet => {
  const ids = new Set<string>();
  return {
    has: id => ids.has(id),
    add: id => {
      ids.add(id);
      while (ids.size > capacity) {
        const oldest = ids.values().next().value;
        if (oldest === undefined) break;
        ids.delete(oldest);
      }
    },
    delete: id => {
      ids.delete(id);
    },
  };
};

const FINALIZED_MESSAGE_LIMIT = 1024;

export function createCoworkStreamPipeline(deps: CoworkStreamPipelineDeps): CoworkStreamPipeline {
  const scheduler = deps.scheduler ?? browserAnimationFrameScheduler;
  const updateBatcher = new RafMessageUpdateBatcher(updates => {
    for (const update of updates) {
      // Metadata-only updates carry no content and therefore must not
      // clear a live-text entry either.
      if (update.metadataOnly === true) continue;
      deps.liveText.clear(update.messageId);
    }
    deps.dispatch(updateMessageContents(updates));
  }, scheduler);
  // StreamPart chunks are applied to the live text store on arrival (the
  // main-process coalescer already batches them per 16 ms window); the store
  // schedules its own rAF notification, so no renderer-side part batcher and
  // no flush points are needed.
  const contentBuffer = new CoworkContentBuffer(sessionId => deps.onContentGap(sessionId));
  const sequenceTracker = new PiUiEventSequenceTracker();
  // Finalized messages are committed to Redux; late StreamPart deltas for them
  // would resurrect live text over the committed content (bounded FIFO).
  const finalizedMessageIds = createBoundedIdSet(FINALIZED_MESSAGE_LIMIT);
  const snapshotBackdoorWarnings = createBoundedIdSet(FINALIZED_MESSAGE_LIMIT);

  const applyContentPatch = (patch: CoworkContentPatch): void => {
    const update = contentBuffer.apply(patch);
    if (patch.metadata?.isStreaming === true) {
      // Streaming base snapshot (non-prefix rewrite / 2M truncation / resync).
      // Only a complete patch carries the whole base: it replaces the base
      // wholesale (chunks already applied on arrival, so ordering with deltas
      // is call order). It is never written to Redux — that would be a
      // full-snapshot "streaming" update, which the architecture forbids.
      if (update?.content !== undefined) {
        deps.liveText.setSnapshot(patch.messageId, update.content, patch.sessionId);
      }
      return;
    }
    if (!update) return;
    if (patch.metadata?.isStreaming === false) finalizedMessageIds.add(patch.messageId);
    updateBatcher.enqueue(update);
  };

  const handleSequenceGap = (sessionId: string): void => {
    // Reset BEFORE requesting the resync: a delta racing in ahead of the base
    // snapshot would render text missing its prefix. resetSession marks the
    // session's live entries awaitingBase so such deltas are dropped until
    // the base snapshot lands.
    deps.liveText.resetSession(sessionId);
    deps.onSequenceGap(sessionId);
    // Ordering contract: the main process first pushes the still-streaming
    // messages' base snapshots through the event sequencer and only then
    // settles the resync result, so endSessionResync sees either the fresh
    // base or a stale entry that correctly falls back to Redux content.
    const finishResync = () => deps.liveText.endSessionResync(sessionId);
    const requested = deps.requestStreamResync?.(sessionId);
    if (requested instanceof Promise) {
      requested.then(finishResync, (error: unknown) => {
        console.error('[CoworkStreamPipeline] stream resync request failed:', error);
        finishResync();
      });
    } else {
      finishResync();
    }
  };

  return {
    handleUiEvent(rawEvent: unknown): void {
      // The preload bridge hands us opaque payloads; ordering/validity is owned
      // by the sequence tracker, so treat the payload as a Pi UI event exactly
      // like the previous inline listener did.
      const event = rawEvent as PiUiEvent;
      if (!sequenceTracker.accept(event)) return;
      const applyEvent = deps.shouldApply(event);
      if (sequenceTracker.consumeGap(event.sessionId) > 0 && event.sessionId) {
        handleSequenceGap(event.sessionId);
      }
      if (!applyEvent) return;
      switch (event.type) {
        case PiUiEventType.Message: {
          const { sessionId, message } = event;
          const state = deps.getCoworkState();
          const sessionExists = [...state.sessions, ...state.chatSessions].some(
            session => session.id === sessionId,
          );
          if (!sessionExists) {
            deps.onUnknownSession(sessionId);
          }
          deps.dispatch(addMessage({ sessionId, message }));
          const content = contentBuffer.latest(message.id);
          if (content !== undefined)
            updateBatcher.enqueue({ sessionId, messageId: message.id, content });
          break;
        }
        case PiUiEventType.Started:
          deps.dispatch(updateSessionStatus({ sessionId: event.sessionId, status: 'running' }));
          break;
        case PiUiEventType.ContentPatch:
          applyContentPatch(event.patch);
          break;
        case PiUiEventType.StreamPart:
          // Terminal states already committed the message to Redux; late
          // deltas would resurrect live text over the committed content.
          if (finalizedMessageIds.has(event.messageId)) break;
          deps.liveText.applyChunk(event.messageId, event.chunk, event.sessionId);
          break;
        case PiUiEventType.MessageRemoved:
          finalizedMessageIds.delete(event.messageId);
          deps.liveText.clear(event.messageId);
          deps.dispatch(removeMessage({ sessionId: event.sessionId, messageId: event.messageId }));
          break;
        case PiUiEventType.MessageUpdate:
          if (event.metadata?.isStreaming === false || event.metadata?.isFinal === true) {
            // Final state: pending deltas are already in the live text
            // (applied on arrival) before the committed Redux update clears
            // the live entry.
            finalizedMessageIds.add(event.messageId);
            if (event.metadata?.metadataOnly === true) {
              // Duplicate terminal emission whose body was already
              // committed — merge the metadata only, never touch content.
              // The transport flag itself must not reach Redux metadata.
              const metadata = { ...event.metadata };
              delete metadata.metadataOnly;
              updateBatcher.enqueue({
                sessionId: event.sessionId,
                messageId: event.messageId,
                metadata,
                metadataOnly: true,
              });
            } else {
              updateBatcher.enqueue({
                sessionId: event.sessionId,
                messageId: event.messageId,
                content: event.content,
                metadata: event.metadata,
              });
            }
          } else if (event.metadata?.streamReopen === true) {
            finalizedMessageIds.delete(event.messageId);
            const metadata = { ...event.metadata };
            delete metadata.streamReopen;
            updateBatcher.enqueue({
              sessionId: event.sessionId,
              messageId: event.messageId,
              content: event.content,
              metadata,
            });
          } else {
            // S6: a full-body MessageUpdate while the message is still
            // streaming is the forbidden "send full text, fake the stream"
            // backdoor. Drop it — live deltas own the streaming text — and
            // warn once per message.
            if (!snapshotBackdoorWarnings.has(event.messageId)) {
              snapshotBackdoorWarnings.add(event.messageId);
              console.warn(
                '[CoworkStreamPipeline] dropped non-final full-content MessageUpdate during streaming:',
                event.messageId,
              );
            }
          }
          break;
        case PiUiEventType.ToolActivity:
          deps.dispatch(updateToolActivity({ sessionId: event.sessionId, event: event.event }));
          break;
        case PiUiEventType.PermissionRequest:
          deps.dispatch(
            enqueuePendingPermission({
              origin: CoworkPermissionOrigin.PiWorkbench,
              sessionId: event.sessionId,
              toolName: event.request.toolName,
              toolInput: event.request.toolInput,
              requestId: event.request.requestId,
              toolUseId: event.request.toolUseId ?? null,
            }),
          );
          break;
        case PiUiEventType.PermissionDismiss:
          deps.dispatch(dequeuePendingPermission({ requestId: event.requestId }));
          break;
        case PiUiEventType.Interrupted:
          updateBatcher.flush();
          deps.dispatch(clearPendingPermissionsForSession(event.sessionId));
          deps.dispatch(updateSessionStatus({ sessionId: event.sessionId, status: 'idle' }));
          break;
        case PiUiEventType.Completed:
          updateBatcher.flush();
          deps.dispatch(updateSessionStatus({ sessionId: event.sessionId, status: 'completed' }));
          break;
        case PiUiEventType.Error: {
          updateBatcher.flush();
          const stateBeforeStatusUpdate = deps.getCoworkState();
          const terminalMessageAlreadyReceived = hasMatchingLatestTerminalError(
            [
              stateBeforeStatusUpdate.currentSession,
              stateBeforeStatusUpdate.streamingSessions[event.sessionId],
            ],
            event.sessionId,
            event.error,
          );
          deps.dispatch(updateSessionStatus({ sessionId: event.sessionId, status: 'error' }));
          if (event.error.message && !terminalMessageAlreadyReceived) {
            deps.dispatch(
              addMessage({
                sessionId: event.sessionId,
                message: createCoworkTerminalErrorMessage(event.error),
              }),
            );
          }
          break;
        }
        case PiUiEventType.QueueUpdated:
          break;
        case PiUiEventType.Stopped:
          updateBatcher.flush();
          deps.dispatch(clearPendingPermissionsForSession(event.sessionId));
          deps.dispatch(updateSessionStatus({ sessionId: event.sessionId, status: 'idle' }));
          break;
        default:
          break;
      }
    },

    flush(): void {
      updateBatcher.flush();
    },

    dispose(): void {
      updateBatcher.dispose();
    },
  };
}
