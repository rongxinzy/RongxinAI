/**
 * Cowork streaming — main-process IPC gateway (coalescer → sequencer → ring buffer → webContents).
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
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { UiMessageChunkCoalescer } from '../streaming/uiMessageChunkCoalescer';
import { PiUiStreamReplayBuffer } from '../piUiStreamReplayBuffer';
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

const forwardPiWorkbenchRuntimeToRenderer = (runtime: PiRuntimeAdapter): void => {
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const runtimeSnapshots = new PiUiRuntimeSnapshots();
  const replayBuffer = new PiUiStreamReplayBuffer();
  const revisionByMessage = new Map<string, number>();

  ipcMain.handle(CoworkStreamIpc.RuntimeSnapshots, (_event, sessionId?: string) =>
    runtimeSnapshots.read(sessionId),
  );

  ipcMain.handle(
    CoworkStreamIpc.UiEventReplay,
    (_event, sessionId: unknown, afterSequence: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return [];
      const after =
        typeof afterSequence === 'number' && Number.isInteger(afterSequence) ? afterSequence : 0;
      return replayBuffer.replay(sessionId, after);
    },
  );

  const broadcastUiEvent = (event: PiUiEvent): void => {
    runtimeSnapshots.observe(event);
    replayBuffer.observe(event);
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
    coalescer.push(sessionId, messageId, chunk);
  };

  const emitStreamSnapshot = (
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): void => {
    coalescer.flush();
    const revision = (revisionByMessage.get(messageId) ?? 0) + 1;
    revisionByMessage.set(messageId, revision);
    const truncated = content.length > 0; // visible content already clipped upstream
    for (const patch of snapshotToContentPatches(
      sessionId,
      { messageId, content, truncated: false },
      revision,
      metadata,
    )) {
      emitUiEvent({ type: PiUiEventType.ContentPatch, sessionId, patch });
    }
  };

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
    replayBuffer.clearSession(sessionId);
    emitUiEvent({ type: PiUiEventType.Stopped, sessionId });
  });

  runtime.on('complete', (sessionId: string) => {
    coalescer.flush();
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
      emitUiEvent({ type: PiUiEventType.Error, sessionId, error });
    },
  );
};

export const bindPiWorkbenchRuntimeForwarder = (): void => {
  if (rt.piWorkbenchRuntimeForwarderBound) return;

  forwardPiWorkbenchRuntimeToRenderer(getPiRuntimeAdapter());
  rt.piWorkbenchRuntimeForwarderBound = true;
};
