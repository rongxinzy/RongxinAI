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
import { createPiUiEventBatcher } from '../piUiEventBatcher';
import { PiUiRuntimeSnapshots } from '../../shared/cowork/piUiRuntimeSnapshot';
import {
  type PiUiEvent,
  type PiUiEventPayload,
  type PiUiMessage,
  PiUiEventType,
  PiUiEventSequencer,
} from '../../shared/cowork/piUiEvent';

const forwardPiWorkbenchRuntimeToRenderer = (runtime: PiRuntimeAdapter): void => {
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const runtimeSnapshots = new PiUiRuntimeSnapshots();
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
  const emitUiEvent = createPiUiEventBatcher((payload: PiUiEventPayload) => {
    broadcastUiEvent(sequencer.next(payload));
  });

  const contentProjection = bindCoworkRunBridge(
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

  runtime.on(
    'messageUpdate',
    (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => {
      void contentProjection
        .project(sessionId, messageId, content, metadata)
        .then(patches => {
          for (const patch of patches)
            emitUiEvent({ type: PiUiEventType.ContentPatch, sessionId, patch });
        })
        .catch(error => console.error('[PiWorkbenchForwarder] content projection failed:', error));
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
    emitUiEvent({ type: PiUiEventType.Stopped, sessionId });
  });

  runtime.on('complete', (sessionId: string) => {
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
      // Persisting the terminal message emits the canonical `message` event
      // first. The UI protocol keeps that ordering before the terminal error.
      emitUiEvent({ type: PiUiEventType.Error, sessionId, error });
    },
  );
};

export const bindPiWorkbenchRuntimeForwarder = (): void => {
  if (rt.piWorkbenchRuntimeForwarderBound) return;

  forwardPiWorkbenchRuntimeToRenderer(getPiRuntimeAdapter());
  rt.piWorkbenchRuntimeForwarderBound = true;
};
