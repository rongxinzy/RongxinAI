/**
 * Cowork streaming — renderer-side Pi UI event pipeline.
 *
 * Extracted verbatim from CoworkService.setupStreamListeners so the whole
 * renderer streaming path (sequence tracker → recovery watermark → content
 * buffer → rAF batchers → live text / Redux dispatch) can be driven
 * end-to-end from node vitest without the global store or `window`.
 *
 * Invariants: StreamPart events carry deltas only; full snapshots are limited
 * to ContentPatch recovery, final MessageUpdate and terminal/error states.
 * **禁止**把全文快照当作常规流式增量分发。
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
import { RafStreamPartBatcher } from './rafStreamPartBatcher';

export type CoworkSliceState = ReturnType<typeof coworkReducer>;

export interface CoworkStreamPipelineDeps {
  dispatch: (action: UnknownAction) => unknown;
  getCoworkState: () => CoworkSliceState;
  liveText: LiveTextStore;
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
  handleContentPatch(patch: CoworkContentPatch): void;
  flush(): void;
  dispose(): void;
}

export function createCoworkStreamPipeline(
  deps: CoworkStreamPipelineDeps,
): CoworkStreamPipeline {
  const scheduler = deps.scheduler ?? browserAnimationFrameScheduler;
  const updateBatcher = new RafMessageUpdateBatcher(
    updates => {
      for (const update of updates) {
        deps.liveText.clear(update.messageId);
      }
      deps.dispatch(updateMessageContents(updates));
    },
    scheduler,
  );
  const liveTextBatcher = new RafStreamPartBatcher(
    parts => {
      for (const part of parts) {
        deps.liveText.applyChunk(part.messageId, part.chunk);
      }
    },
    scheduler,
  );
  const contentBuffer = new CoworkContentBuffer(sessionId => deps.onContentGap(sessionId));
  const sequenceTracker = new PiUiEventSequenceTracker();

  return {
    handleUiEvent(rawEvent: unknown): void {
      // The preload bridge hands us opaque payloads; ordering/validity is owned
      // by the sequence tracker, so treat the payload as a Pi UI event exactly
      // like the previous inline listener did.
      const event = rawEvent as PiUiEvent;
      if (!sequenceTracker.accept(event)) return;
      const applyEvent = deps.shouldApply(event);
      if (sequenceTracker.consumeGap(event.sessionId) > 0 && event.sessionId) {
        deps.onSequenceGap(event.sessionId);
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
        case PiUiEventType.ContentPatch: {
          const update = contentBuffer.apply(event.patch);
          const live = contentBuffer.live(event.patch.messageId);
          if (live !== undefined) deps.liveText.setSnapshot(event.patch.messageId, live);
          if (update) updateBatcher.enqueue(update);
          break;
        }
        case PiUiEventType.StreamPart:
          liveTextBatcher.enqueue({
            sessionId: event.sessionId,
            messageId: event.messageId,
            chunk: event.chunk,
          });
          break;
        case PiUiEventType.MessageUpdate:
          if (event.metadata?.isFinal === true) {
            updateBatcher.enqueue({
              sessionId: event.sessionId,
              messageId: event.messageId,
              content: event.content,
              metadata: event.metadata,
            });
          } else {
            deps.liveText.setSnapshot(event.messageId, event.content);
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

    handleContentPatch(patch: CoworkContentPatch): void {
      const update = contentBuffer.apply(patch);
      const live = contentBuffer.live(patch.messageId);
      if (live !== undefined) deps.liveText.setSnapshot(patch.messageId, live);
      if (update) updateBatcher.enqueue(update);
    },

    flush(): void {
      liveTextBatcher.flush();
      updateBatcher.flush();
    },

    dispose(): void {
      updateBatcher.dispose();
      liveTextBatcher.dispose();
    },
  };
}
