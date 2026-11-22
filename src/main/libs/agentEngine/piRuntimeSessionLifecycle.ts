/**
 * Session lifecycle operations for the Pi runtime adapter.
 *
 * Extracted from PiRuntimeAdapter: stopping active sessions (closing
 * in-flight tool uses, recording interruptions and closing queued-input metadata),
 * disposing sessions before a resource-driven recreation, idle-session
 * eviction, and deletion cleanup.
 */

import { observeWorkbench } from '../../workbenchTask/observe';

import { randomUUID } from 'crypto';

import { CoworkSessionStatus } from '../../../shared/cowork/constants';
import {
  CoworkInterruptionCause,
  type CoworkSessionInterruption,
} from '../../../shared/cowork/interruption';
import type { CoworkMessage } from '../../coworkStore';
import { interruptedToolResult } from '../../coworkStore/messageStore';
import type { ActivePiSession } from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';

/** Idle Pi sessions beyond this count are evicted even before their TTL. */
const MAX_RESIDENT_IDLE_SESSIONS = 4;
/** Idle Pi sessions are evicted after 30 minutes without a turn. */
const IDLE_SESSION_TTL_MS = 30 * 60 * 1000;

export function disposePiSessionForRecreation(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  active: ActivePiSession,
): void {
  // A queued control action belongs to the turn that queued it; replaying it
  // after a resource-driven recreation would be an unexpected side effect.
  host.queue.dropControlActions(sessionId);
  host.queue.discardRecreatedSessionFollowUps(sessionId);
  host.recovery.dismissAskUserQuestionsBySession(sessionId);
  host.recovery.dismissCodingElicitationsBySession(sessionId, 'The session was recreated.');
  active.artifactRecorder?.dispose();
  host.transcript.clearThrottleStateBySession(sessionId, false);
  active.pendingError = null;
  active.toolStartedAtByCallId.clear();
  const clearActivity = active.toolActivityTracker.clear();
  if (clearActivity) host.emit('toolActivity', sessionId, clearActivity);
  host.stopNativeSession(sessionId, active);
  const { workbenchRunId } = active;
  if (workbenchRunId) {
    observeWorkbench(sessionId, () => {
      host
        .getWorkbenchTaskService(sessionId)
        ?.cancelRun?.(
          sessionId,
          workbenchRunId,
          'The session resources changed before completion.',
        );
    });
  }
  host.clearToolPermissionsBySession(sessionId);
  host.memoryInjectionDedup.reset(sessionId);
  host.activeSessions.delete(sessionId);
}

export function stopActivePiRuntimeSession(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  reason: string,
  options?: { cause?: CoworkInterruptionCause; discardTranscript?: boolean },
): void {
  const cause = options?.cause;
  const persistTranscript = !options?.discardTranscript;
  // Control actions are not durable user input: an explicit stop must not
  // carry them into a later session that reuses the same id.
  host.queue.dropControlActions(sessionId);
  host.recovery.dismissAskUserQuestionsBySession(sessionId);
  host.recovery.dismissCodingElicitationsBySession(sessionId, reason);
  const initializing = host.initializingSessions.get(sessionId);
  if (initializing) {
    if (initializing.nativeAcquisition)
      host.trackNativeSessionStop(sessionId, initializing.nativeAcquisition);
    initializing.abortController.abort();
    host.initializingSessions.delete(sessionId);
    initializing.onSettled?.({ ok: false, error: reason });
  }
  const active = host.activeSessions.get(sessionId);
  if (!active) {
    host.transcript.clearThrottleStateBySession(sessionId, false);
    if (persistTranscript) closeInterruptedToolUses(host, sessionId);
    if (!initializing || initializing.workbenchRunId) {
      observeWorkbench(sessionId, () =>
        host
          .getWorkbenchTaskService(sessionId)
          ?.cancelRun?.(sessionId, initializing?.workbenchRunId, reason),
      );
    }
    host.clearToolPermissionsBySession(sessionId);
    if (cause && (initializing || !host.retainedSessionIds.has(sessionId))) {
      recordSessionInterruption(host, sessionId, cause);
    }
    if (initializing) host.emit('sessionStopped', sessionId);
    return;
  }
  if (!active.isRunning && active.aborted) return;

  const transcriptErrors: unknown[] = [];
  if (persistTranscript) {
    try {
      host.transcript.finalizeActiveThinking(sessionId, active);
      // Close in-flight tools before the turn is marked paused.
      closeInterruptedToolUses(host, sessionId);
    } catch (error) {
      transcriptErrors.push(error);
    }
  }

  // Mark the session as aborted so continueSession knows not to reuse the Pi
  // session object, which may be in an inconsistent state after abort.
  active.aborted = true;
  active.isRunning = false;
  active.turnFailed = false;
  const onSettled = active.onSettled;
  active.onSettled = undefined;
  active.artifactRecorder?.dispose();
  // Drop any deferred error without surfacing it — the user stopped the turn.
  active.pendingError = null;
  active.retryStreamReusePending = false;
  host.transcript.clearPendingContextUsage(sessionId);
  active.toolStartedAtByCallId.clear();
  const clearActivity = active.toolActivityTracker.clear();
  if (clearActivity) host.emit('toolActivity', sessionId, clearActivity);

  // Drop the Pi session after the turn is aborted. IM routing still treats the
  // session as active via retainedSessionIds, and the next turn rebuilds from SQLite.
  host.stopNativeSession(sessionId, active);
  host.queue.resetNativeDispatch(sessionId);
  const { workbenchRunId } = active;
  if (workbenchRunId) {
    observeWorkbench(sessionId, () =>
      host.getWorkbenchTaskService(sessionId)?.cancelRun?.(sessionId, workbenchRunId, reason),
    );
  }
  host.clearToolPermissionsBySession(sessionId);
  onSettled?.({ ok: false, error: reason });
  host.emit('sessionStopped', sessionId);
  if (cause) {
    try {
      recordSessionInterruption(host, sessionId, cause);
    } catch (error) {
      transcriptErrors.push(error);
    }
  }

  // Stopping closes idle placeholders so a partial answer bubble with
  // isStreaming metadata cannot stay in flight after the run is gone; any
  // partial body it persists is bounded by the checkpoint policy.
  if (persistTranscript) {
    try {
      host.transcript.closeIdlePlaceholders(sessionId, active);
    } catch (error) {
      transcriptErrors.push(error);
    }
  }
  releaseStoppedSession(host, sessionId);
  host.queue.clear(sessionId);
  if (transcriptErrors.length === 1) throw transcriptErrors[0];
  if (transcriptErrors.length > 1) {
    throw new AggregateError(
      transcriptErrors,
      `Failed to finalize the transcript for ${sessionId}.`,
    );
  }
}

/** Persist a terminal result for tool calls still open when the user pauses. */
function closeInterruptedToolUses(host: PiRuntimeAdapterHost, sessionId: string): void {
  const messageStore = host.getStore(sessionId)?.messages;
  if (!messageStore) return;
  let openCalls: string[];
  try {
    openCalls = messageStore.listOpenToolUseIds(sessionId);
  } catch {
    return;
  }
  for (const toolUseId of openCalls) {
    const result = interruptedToolResult(
      toolUseId,
      'The command was interrupted because the task was paused.',
    );
    const persisted = messageStore.addMessage(sessionId, result);
    host.emit('message', sessionId, persisted);
  }
}

function recordSessionInterruption(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  cause: CoworkInterruptionCause,
): void {
  const interruption: CoworkSessionInterruption = {
    sessionId,
    interruptionId: randomUUID(),
    cause,
    taskId: null,
    recoverable: false,
  };
  const seed: CoworkMessage = {
    id: randomUUID(),
    type: 'system',
    content: '',
    timestamp: Date.now(),
    metadata: { interruption },
  };
  const store = host.getStore(sessionId);
  const message = store
    ? store.messages.addMessage(sessionId, seed, seed.timestamp, CoworkSessionStatus.Idle)
    : seed;
  host.emit('message', sessionId, message);
  host.emit('sessionInterrupted', interruption);
}

export function stopAllPiRuntimeSessions(host: PiRuntimeAdapterHost): void {
  const sessionIds = new Set([...host.activeSessions.keys(), ...host.initializingSessions.keys()]);
  const errors: unknown[] = [];
  for (const sessionId of sessionIds) {
    try {
      stopActivePiRuntimeSession(host, sessionId, 'The application stopped the active session.');
    } catch (error) {
      errors.push(error);
    }
  }
  host.transcript.clearAll();
  if (errors.length) throw new AggregateError(errors, 'Failed to close all Pi session state.');
}

export async function onPiSessionDeleted(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  piHistoryKey?: string | null,
): Promise<void> {
  stopActivePiRuntimeSession(host, sessionId, 'The session was deleted.', {
    discardTranscript: true,
  });
  host.clearToolPermissionsBySession(sessionId);
  host.memoryInjectionDedup.reset(sessionId);
  host.activeSessions.delete(sessionId);
  host.retainedSessionIds.delete(sessionId);
  host.transcript.clearThrottleStateBySession(sessionId, true);
  // queue.clear emits queueUpdated itself when the session had queued items.
  host.queue.clear(sessionId);
  await host.waitForNativeSessionStop(sessionId);
  await host.invalidatePiSessionDir(sessionId, piHistoryKey);
}

export function evictIdlePiRuntimeSessions(host: PiRuntimeAdapterHost, now = Date.now()): void {
  const idle = [...host.activeSessions.values()]
    .filter(session => {
      if (session.isRunning || session.revalidatingModelScope) return false;
      if (session.artifactRecorder?.pendingFinalCapture) return false;
      if (host.queue.hasPendingFollowUp(session.sessionId)) return false;
      if (host.queue.hasQueuedControlActions(session.sessionId)) return false;
      return now - session.lastUsedAt >= IDLE_SESSION_TTL_MS;
    })
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  const residentIdle = [...host.activeSessions.values()].filter(
    session =>
      !session.isRunning &&
      !session.revalidatingModelScope &&
      !host.queue.hasPendingFollowUp(session.sessionId),
  ).length;
  const excessCount = Math.max(0, residentIdle - MAX_RESIDENT_IDLE_SESSIONS);
  const expired = idle.filter(session => now - session.lastUsedAt >= IDLE_SESSION_TTL_MS);
  const nonExpired = idle.filter(session => now - session.lastUsedAt < IDLE_SESSION_TTL_MS);
  const candidates = [
    ...expired,
    ...nonExpired.slice(0, Math.max(0, excessCount - expired.length)),
  ];
  for (const session of candidates) {
    session.artifactRecorder?.dispose();
    host.stopNativeSession(session.sessionId, session);
    host.queue.resetNativeDispatch(session.sessionId);
    host.memoryInjectionDedup.reset(session.sessionId);
    host.activeSessions.delete(session.sessionId);
    host.retainedSessionIds.add(session.sessionId);
    host.transcript.clearThrottleStateBySession(session.sessionId, true);
    console.debug(`[PiRuntime] evicted idle session ${session.sessionId} from memory`);
  }
}

function releaseStoppedSession(host: PiRuntimeAdapterHost, sessionId: string): void {
  host.memoryInjectionDedup.reset(sessionId);
  host.activeSessions.delete(sessionId);
  host.retainedSessionIds.add(sessionId);
  host.transcript.clearThrottleStateBySession(sessionId, true);
}
