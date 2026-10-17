/**
 * Cowork streaming — main-process IPC gateway (coalescer → sequencer → webContents).
 * See docs/architecture/streaming.md for end-to-end flow and prohibitions.
 */
import crypto from 'crypto';

import { BrowserWindow, ipcMain } from 'electron';

import { rt } from './runtimeState';
import { getCoworkStore, getStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { sanitizeCoworkMessageForIpc, sanitizePermissionRequestForIpc } from './ipcPayloadSanitize';
import { CoworkStreamIpc } from '../../shared/ipc/channels';
import { bindCoworkRunBridge } from '../coworkRunBridge';
import { slimQueuedMessagesForIpc } from '../coworkImageAttachments';
import { persistCoworkTerminalError } from '../coworkTerminalErrorPersistence';
import { CoworkRunPolicy } from '../../shared/cowork/runState';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { UiMessageChunkCoalescer } from '../streaming/uiMessageChunkCoalescer';
import { snapshotToContentPatches } from '../piUiStreamGateway';
import { PiUiRuntimeSnapshots } from '../../shared/cowork/piUiRuntimeSnapshot';
import {
  type PiUiEvent,
  type PiUiEventPayload,
  type PiUiMessage,
  PiUiEventType,
  PiUiEventSequencer,
} from '../../shared/cowork/piUiEvent';
import type { UIMessageChunk } from 'ai';

export const forwardPiWorkbenchRuntimeToRenderer = (runtime: PiRuntimeAdapter): void => {
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const runtimeSnapshots = new PiUiRuntimeSnapshots();

  // ContentPatch revisions only need to be monotonic per message. A single
  // global counter is monotonic for every message at once, and avoids keeping
  // per-message revision state alive beyond a message's lifecycle.
  let contentPatchRevision = 0;
  const nextRevision = (): number => {
    contentPatchRevision += 1;
    return contentPatchRevision;
  };

  // 2M guard bookkeeping (CoworkRunPolicy.MaximumContentCharacters): how many
  // characters each message has already streamed, and which messages are over
  // the cap and therefore drop every further delta.
  const sentCharsByMessage = new Map<string, number>();
  const truncatedMessages = new Set<string>();
  const sessionByMessageId = new Map<string, string>();

  // Terminal-channel dedup: the last final body already forwarded per
  // message. finalizeMessage and markFinalAnswer both publish the same final
  // text after message_end; the repeat must not re-send the whole body (and
  // its ContentPatch fan-out), so it degrades to a metadata-only
  // MessageUpdate. Entries are owned by session via sessionByMessageId and
  // cleared with the session, plus a FIFO cap as a hard bound.
  // **禁止**把同一条消息的终态正文整段下发两遍。
  const finalContentByMessage = new Map<string, string>();
  const FINAL_CONTENT_TRACK_LIMIT = 1024;

  const rememberFinalContent = (messageId: string, content: string): void => {
    finalContentByMessage.set(messageId, content);
    while (finalContentByMessage.size > FINAL_CONTENT_TRACK_LIMIT) {
      const oldest = finalContentByMessage.keys().next().value;
      if (oldest === undefined) break;
      finalContentByMessage.delete(oldest);
    }
  };

  const clearTruncationForMessage = (messageId: string): void => {
    sentCharsByMessage.delete(messageId);
    truncatedMessages.delete(messageId);
  };

  // Session teardown (sessionStopped / complete / error) drops every
  // per-message bookkeeping entry owned by that session — truncation
  // accounting, stream ownership and the terminal-dedup memory — so nothing
  // leaks across sessions.
  const clearSessionStreamBookkeeping = (sessionId: string): void => {
    for (const [messageId, owner] of sessionByMessageId) {
      if (owner !== sessionId) continue;
      clearTruncationForMessage(messageId);
      finalContentByMessage.delete(messageId);
      sessionByMessageId.delete(messageId);
    }
  };

  ipcMain.handle(CoworkStreamIpc.RuntimeSnapshots, (_event, sessionId?: string) =>
    runtimeSnapshots.read(sessionId),
  );

  const broadcastUiEvent = (event: PiUiEvent): void => {
    runtimeSnapshots.observe(event);
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.UiEvent, event);
      } catch (error) {
        console.error('[PiWorkbenchForwarder] failed to forward a Pi UI event:', error);
      }
    });
  };

  const emitUiEvent = (payload: PiUiEventPayload): void => {
    coalescer.flush();
    broadcastUiEvent(sequencer.next(payload));
  };

  const coalescer = new UiMessageChunkCoalescer(({ sessionId, messageId, chunk }) => {
    broadcastUiEvent(
      sequencer.next({
        type: PiUiEventType.StreamPart,
        sessionId,
        messageId,
        chunk,
      }),
    );
  });

  const emitStreamChunk = (sessionId: string, messageId: string, chunk: UIMessageChunk): void => {
    sessionByMessageId.set(messageId, sessionId);
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      // 2M guard: once a message's streamed length reaches the cap, every
      // later delta is dropped; the terminal snapshot still delivers the
      // clipped full text.
      if (truncatedMessages.has(messageId)) return;
      const sent = sentCharsByMessage.get(messageId) ?? 0;
      const budget = CoworkRunPolicy.MaximumContentCharacters - sent;
      if (budget <= 0) {
        truncatedMessages.add(messageId);
        return;
      }
      if (chunk.delta.length > budget) {
        // Clip this delta to the remaining budget (nothing to send when the
        // budget is zero) and mark the message truncated.
        sentCharsByMessage.set(messageId, CoworkRunPolicy.MaximumContentCharacters);
        truncatedMessages.add(messageId);
        coalescer.push(sessionId, messageId, { ...chunk, delta: chunk.delta.slice(0, budget) });
        return;
      }
      sentCharsByMessage.set(messageId, sent + chunk.delta.length);
    }
    coalescer.push(sessionId, messageId, chunk);
  };

  /**
   * Full-text snapshot on exceptional paths only (non-prefix rewrite, gap
   * resync, terminal state). The patch metadata is forced to
   * `isStreaming: true` so the renderer treats it as a streaming base and
   * appends following deltas, never as a terminal/restore snapshot.
   */
  const emitStreamSnapshot = (
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): void => {
    coalescer.flush();
    sessionByMessageId.set(messageId, sessionId);
    const truncated = content.length > CoworkRunPolicy.MaximumContentCharacters;
    const visible = truncated
      ? content.slice(0, CoworkRunPolicy.MaximumContentCharacters)
      : content;
    // Reseed the streamed-length accounting from the snapshot so later deltas
    // keep respecting the same cap.
    sentCharsByMessage.set(messageId, visible.length);
    if (truncated) truncatedMessages.add(messageId);
    else truncatedMessages.delete(messageId);
    for (const patch of snapshotToContentPatches(
      sessionId,
      { messageId, content: visible, truncated },
      nextRevision(),
      { ...metadata, isStreaming: true },
    )) {
      emitUiEvent({ type: PiUiEventType.ContentPatch, sessionId, patch });
    }
  };

  // Renderer-initiated resync (delta-sequence gap or mid-stream attach):
  // flush pending deltas, then reseed every live (unfinalized) message with
  // one full snapshot; subsequent deltas append onto that base.
  ipcMain.handle(CoworkStreamIpc.StreamResync, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
    coalescer.flush();
    for (const live of runtime.getLiveStreamTexts(sessionId)) {
      emitStreamSnapshot(sessionId, live.messageId, live.content, live.metadata);
    }
    return true;
  });

  bindCoworkRunBridge(
    runtime,
    () => getStore().getDatabase(),
    patch => emitUiEvent({ type: PiUiEventType.ContentPatch, sessionId: patch.sessionId, patch }),
  );

  runtime.on('started', (sessionId: string) => {
    emitUiEvent({ type: PiUiEventType.Started, sessionId });
  });

  runtime.on('message', (sessionId: string, message: unknown) => {
    const safeMessage = sanitizeCoworkMessageForIpc(message);
    emitUiEvent({
      type: PiUiEventType.Message,
      sessionId,
      message: safeMessage as PiUiMessage,
    });
  });

  runtime.on('uiStreamChunk', (sessionId: string, messageId: string, chunk: UIMessageChunk) => {
    emitStreamChunk(sessionId, messageId, chunk);
  });

  runtime.on(
    'uiStreamSnapshot',
    (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => {
      emitStreamSnapshot(sessionId, messageId, content, metadata);
    },
  );

  // Terminal channel (B2): finalizeMessage / markFinalAnswer /
  // closeIdlePlaceholders / context-usage sync publish their final content and
  // `isStreaming: false` here. Non-final messageUpdate is a throttled
  // in-process bus event for IM and the coding room; forwarding it would
  // reintroduce full-text snapshots on the UI IPC path, so it is dropped.
  runtime.on(
    'messageUpdate',
    (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => {
      if (metadata?.streamReopen === true) {
        coalescer.flush();
        sessionByMessageId.set(messageId, sessionId);
        emitUiEvent({
          type: PiUiEventType.MessageUpdate,
          sessionId,
          messageId,
          content,
          metadata,
        });
        return;
      }
      if (metadata?.isStreaming !== false) return;
      coalescer.flush();
      sessionByMessageId.set(messageId, sessionId);
      const truncated = content.length > CoworkRunPolicy.MaximumContentCharacters;
      const visible = truncated
        ? content.slice(0, CoworkRunPolicy.MaximumContentCharacters)
        : content;
      const finalMetadata = truncated ? { ...metadata, contentTruncated: true } : { ...metadata };
      // Terminal dedup: when this final body is byte-identical to the
      // one already forwarded for the message (finalizeMessage →
      // markFinalAnswer), emit a metadata-only MessageUpdate instead of
      // re-sending the full body (or its ContentPatch fan-out). Compare
      // length first, then the string, to keep the check cheap.
      const lastFinalContent = finalContentByMessage.get(messageId);
      const duplicateFinal =
        lastFinalContent !== undefined &&
        lastFinalContent.length === visible.length &&
        lastFinalContent === visible;
      if (duplicateFinal) {
        emitUiEvent({
          type: PiUiEventType.MessageUpdate,
          sessionId,
          messageId,
          content: '',
          metadata: { ...finalMetadata, metadataOnly: true },
        });
        clearTruncationForMessage(messageId);
        return;
      }
      rememberFinalContent(messageId, visible);
      if (visible.length <= CoworkRunPolicy.ContentChunkCharacters) {
        emitUiEvent({
          type: PiUiEventType.MessageUpdate,
          sessionId,
          messageId,
          content: visible,
          metadata: finalMetadata,
        });
      } else {
        for (const patch of snapshotToContentPatches(
          sessionId,
          { messageId, content: visible, truncated },
          nextRevision(),
          finalMetadata,
        )) {
          emitUiEvent({ type: PiUiEventType.ContentPatch, sessionId, patch });
        }
      }
      clearTruncationForMessage(messageId);
    },
  );

  runtime.on('toolActivity', (sessionId, event) => {
    emitUiEvent({ type: PiUiEventType.ToolActivity, sessionId, event });
  });

  runtime.on('queueUpdated', (sessionId, items) => {
    const safeItems = slimQueuedMessagesForIpc(items);
    emitUiEvent({ type: PiUiEventType.QueueUpdated, sessionId, items: safeItems });
  });

  runtime.on('permissionRequest', (sessionId: string, request: unknown) => {
    if (runtime.getSessionConfirmationMode(sessionId) === 'text') {
      return;
    }
    const safeRequest = sanitizePermissionRequestForIpc(request);
    if (!safeRequest || typeof safeRequest !== 'object') return;
    const requestRecord = safeRequest as Record<string, unknown>;
    if (typeof requestRecord.requestId !== 'string' || typeof requestRecord.toolName !== 'string') {
      console.warn('[PiWorkbenchForwarder] ignored a malformed permission request');
      return;
    }
    const toolInput =
      requestRecord.toolInput && typeof requestRecord.toolInput === 'object'
        ? (requestRecord.toolInput as Record<string, unknown>)
        : {};
    emitUiEvent({
      type: PiUiEventType.PermissionRequest,
      sessionId,
      request: {
        requestId: requestRecord.requestId,
        toolName: requestRecord.toolName,
        toolInput,
        ...(typeof requestRecord.toolUseId === 'string'
          ? { toolUseId: requestRecord.toolUseId }
          : {}),
      },
    });
  });

  runtime.on('permissionDismiss', (requestId: string) => {
    emitUiEvent({ type: PiUiEventType.PermissionDismiss, sessionId: null, requestId });
  });

  runtime.on('sessionInterrupted', interruption => {
    emitUiEvent({
      type: PiUiEventType.Interrupted,
      sessionId: interruption.sessionId,
      interruption,
    });
  });

  runtime.on('sessionStopped', (sessionId: string) => {
    coalescer.flush();
    clearSessionStreamBookkeeping(sessionId);
    emitUiEvent({ type: PiUiEventType.Stopped, sessionId });
  });

  runtime.on('complete', (sessionId: string) => {
    coalescer.flush();
    clearSessionStreamBookkeeping(sessionId);
    emitUiEvent({
      type: PiUiEventType.Completed,
      sessionId,
    });
  });

  runtime.on(
    'error',
    (sessionId: string, error: import('../../common/coworkError').CoworkError) => {
      try {
        persistCoworkTerminalError(
          getStore().getDatabase(),
          getCoworkStore(),
          sessionId,
          error,
          message => runtime.emit('message', sessionId, message),
        );
      } catch (persistenceError) {
        console.error(
          `[PiWorkbenchForwarder] failed to persist an error for session ${sessionId}:`,
          persistenceError,
        );
      }
      coalescer.flush();
      clearSessionStreamBookkeeping(sessionId);
      emitUiEvent({ type: PiUiEventType.Error, sessionId, error });
    },
  );
};

export const bindPiWorkbenchRuntimeForwarder = (): void => {
  if (rt.piWorkbenchRuntimeForwarderBound) return;

  forwardPiWorkbenchRuntimeToRenderer(getPiRuntimeAdapter());
  rt.piWorkbenchRuntimeForwarderBound = true;
};
