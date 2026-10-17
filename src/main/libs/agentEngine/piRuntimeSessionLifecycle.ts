/**
 * Session lifecycle operations for the Pi runtime adapter.
 *
 * Extracted from PiRuntimeAdapter: stopping active sessions (closing
 * in-flight tool uses, recording interruptions, draining queued follow-ups),
 * disposing sessions before a resource-driven recreation, idle-session
 * eviction, and deletion cleanup.
 */

import { randomUUID } from 'crypto';

import {
  CoworkInterruptionCause,
  type CoworkSessionInterruption,
} from '../../../shared/cowork/interruption';
import { WorkbenchContractKind, WorkbenchTaskStatus } from '../../../shared/workbenchTask';
import type { CoworkMessage } from '../../coworkStore';
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
  host.recovery.dismissAskUserQuestionsBySession(sessionId);
  host.recovery.dismissCodingElicitationsBySession(sessionId, 'The session was recreated.');
  active.agentLoop.stop();
  active.pendingError = null;
  active.toolStartedAtByCallId.clear();
  const clearActivity = active.toolActivityTracker.clear();
  if (clearActivity) host.emit('toolActivity', sessionId, clearActivity);
  active.piSession.abortBash();
  active.abortController.abort();
  active.unsubscribe();
  void active.piSession.abort();
  host
    .getWorkbenchTaskService()
    ?.pauseRun?.(sessionId, 'The session resources changed before the approval was resolved.');
  host.recovery.clearApprovalsBySession(sessionId);
  host.memoryInjectionDedup.reset(sessionId);
  host.activeSessions.delete(sessionId);
}

export function stopActivePiRuntimeSession(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  reason: string,
  drainQueuedFollowUp: boolean,
  cause?: CoworkInterruptionCause,
): void {
  // Control actions are not durable user input: an explicit stop must not
  // carry them into a later session that reuses the same id.
  host.queue.dropControlActions(sessionId);
  host.recovery.dismissAskUserQuestionsBySession(sessionId);
  host.recovery.dismissCodingElicitationsBySession(sessionId, reason);
  const initializing = host.initializingSessions.get(sessionId);
  if (initializing) {
    initializing.abortController.abort();
    host.initializingSessions.delete(sessionId);
  }
  const active = host.activeSessions.get(sessionId);
  if (!active) {
    closeInterruptedToolUses(host, sessionId);
    host.getWorkbenchTaskService()?.pauseRun?.(sessionId, reason);
    host.recovery.clearApprovalsBySession(sessionId);
    if (cause && !host.retainedSessionIds.has(sessionId)) {
      recordSessionInterruption(host, sessionId, cause);
    }
    return;
  }
  const wasRunning = active.isRunning;
  if (!wasRunning && active.aborted) return;

  host.transcript.finalizeActiveThinking(sessionId, active);
  // Close in-flight tools before the turn is marked paused. Otherwise resume
  // starts a new command while the previous one still looks "running".
  closeInterruptedToolUses(host, sessionId);

  // Mark the session as aborted so continueSession knows not to reuse the Pi
  // session object, which may be in an inconsistent state after abort.
  active.aborted = true;
  active.isRunning = false;
  active.turnFailed = false;
  active.agentLoop.stop();
  // Drop any deferred error without surfacing it — the user stopped the turn.
  active.pendingError = null;
  active.toolStartedAtByCallId.clear();
  const clearActivity = active.toolActivityTracker.clear();
  if (clearActivity) host.emit('toolActivity', sessionId, clearActivity);

  // Drop the Pi session after the turn is aborted. IM routing still treats the
  // session as active via retainedSessionIds, and the next turn rebuilds from SQLite.
  active.piSession.abortBash();
  active.abortController.abort();
  active.unsubscribe();
  void active.piSession.abort();
  host.getWorkbenchTaskService()?.pauseRun?.(sessionId, reason);
  host.recovery.clearApprovalsBySession(sessionId);
  host.emit('sessionStopped', sessionId);
  if (cause) recordSessionInterruption(host, sessionId, cause);

  const shouldDrainFollowUp =
    wasRunning &&
    drainQueuedFollowUp &&
    active.workbenchContract.kind !== WorkbenchContractKind.Chat &&
    host.queue.hasPendingFollowUp(sessionId);
  releaseStoppedSession(host, sessionId);
  // Stopping flushes the throttled store write, which may carry isStreaming; the
  // partial answer bubble must not stay in flight after the run is gone.
  host.transcript.closeIdlePlaceholders(sessionId, active);

  if (shouldDrainFollowUp) {
    host.queue.resumeNextFollowUp(sessionId);
  }
}

/** Persist a terminal result for tool calls still open when the user pauses. */
function closeInterruptedToolUses(host: PiRuntimeAdapterHost, sessionId: string): void {
  const store = host.getStore();
  if (!store || typeof store.getSessionMessagesDesc !== 'function') return;

  // Scan through the page containing the latest user message. Keep that
  // whole boundary page so nearby orphan tool calls still receive terminal
  // results, as in the previous full scan. Persist results oldest-first.
  const tailNewestFirst: CoworkMessage[] = [];
  const pageSize = 200;
  let offset = 0;
  try {
    for (;;) {
      const page = store.getSessionMessagesDesc(sessionId, pageSize, offset);
      if (page.length === 0) break;
      offset += page.length;
      tailNewestFirst.push(...page);
      if (page.some(message => message.type === 'user') || page.length < pageSize) break;
    }
  } catch {
    return;
  }
  if (tailNewestFirst.length === 0) return;
  const messages = tailNewestFirst.reverse();

  const closed = new Set<string>();
  for (const message of messages) {
    if (message.type !== 'tool_result') continue;
    const toolUseId = message.metadata?.toolUseId;
    if (typeof toolUseId === 'string' && toolUseId) closed.add(toolUseId);
  }

  for (const message of messages) {
    if (message.type !== 'tool_use') continue;
    const toolUseId = message.metadata?.toolUseId;
    if (typeof toolUseId !== 'string' || !toolUseId || closed.has(toolUseId)) continue;
    const result: CoworkMessage = {
      id: randomUUID(),
      type: 'tool_result',
      content: 'The command was interrupted because the task was paused.',
      timestamp: Date.now(),
      metadata: {
        toolUseId,
        isError: true,
        error: 'interrupted',
        isStreaming: false,
        isFinal: true,
      },
    };
    const persisted = store.addMessage(sessionId, result);
    host.emit('message', sessionId, persisted);
    closed.add(toolUseId);
  }
}

function recordSessionInterruption(
  host: PiRuntimeAdapterHost,
  sessionId: string,
  cause: CoworkInterruptionCause,
): CoworkSessionInterruption {
  const task = host.getWorkbenchTaskService()?.getCurrent(sessionId)?.task ?? null;
  const resumableTask = task?.contract.kind === WorkbenchContractKind.Chat ? null : task;
  const interruption: CoworkSessionInterruption = {
    sessionId,
    interruptionId: randomUUID(),
    cause,
    taskId: resumableTask?.id ?? null,
    recoverable: resumableTask?.status === WorkbenchTaskStatus.Paused,
  };
  const seed: CoworkMessage = {
    id: randomUUID(),
    type: 'system',
    content: '',
    timestamp: Date.now(),
    metadata: { interruption },
  };
  const store = host.getStore();
  const message = store ? store.addMessage(sessionId, seed) : seed;
  store?.updateSession(sessionId, { status: 'idle' });
  host.emit('message', sessionId, message);
  host.emit('sessionInterrupted', interruption);
  return interruption;
}

export function stopAllPiRuntimeSessions(host: PiRuntimeAdapterHost): void {
  const sessionIds = new Set([...host.activeSessions.keys(), ...host.initializingSessions.keys()]);
  for (const sessionId of sessionIds) {
    stopActivePiRuntimeSession(
      host,
      sessionId,
      'The application stopped the active session.',
      false,
    );
  }
  void host.cadViewerService.stop();
}

export function onPiSessionDeleted(host: PiRuntimeAdapterHost, sessionId: string): void {
  stopActivePiRuntimeSession(host, sessionId, 'The session was deleted.', false);
  host.recovery.clearApprovalsBySession(sessionId);
  host.memoryInjectionDedup.reset(sessionId);
  host.activeSessions.delete(sessionId);
  host.retainedSessionIds.delete(sessionId);
  host.transcript.clearThrottleStateBySession(sessionId, true);
  // queue.clear emits queueUpdated itself when the session had queued items.
  host.queue.clear(sessionId);
  host.getWorkbenchTaskService()?.deleteSession(sessionId);
}

export function evictIdlePiRuntimeSessions(host: PiRuntimeAdapterHost, now = Date.now()): void {
  const idle = [...host.activeSessions.values()]
    .filter(session => {
      if (session.isRunning || session.completionPending) return false;
      if (host.queue.hasPendingFollowUp(session.sessionId)) return false;
      if (host.queue.hasQueuedControlActions(session.sessionId)) return false;
      return now - session.lastUsedAt >= IDLE_SESSION_TTL_MS;
    })
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  const residentIdle = [...host.activeSessions.values()].filter(
    session =>
      !session.isRunning &&
      !session.completionPending &&
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
    session.unsubscribe();
    session.piSession.abortBash();
    void session.piSession.abort();
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
