/**
 * Pending-message queue and control-action runtime for the Pi adapter.
 *
 * Extracted from PiRuntimeAdapter: owns the Cowork pending Work-message metadata
 * sidecar and the application-owned control actions that run after queued prompts
 * settle. Native follow-up and steer queues are delegated directly to Pi.
 */

import { randomUUID } from 'crypto';

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { hasVisiblePromptContent } from '../../../shared/cowork/submissionContent';
import type { CoworkMessage } from '../../coworkStore';
import { PiPendingMessageQueue } from './piPendingMessageQueue';
import {
  haveSameStringList,
  mergeSkillIds,
  preparePiPrompt,
  sendPiPrompt,
  type ActivePiSession,
} from './piRuntimeSessionState';
import type { PiContinueOptions } from './piRuntimeTypes';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { collectImagePathReferences } from './piImageInputFallback';
import { resolvePiSkillRoots } from './piSkillRoots';
import { resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';

export class PiRuntimeQueueController {
  private readonly pendingMessageQueue = new PiPendingMessageQueue();
  /** Opaque application actions that run after queued Work prompts settle. */
  private readonly queuedControlActions = new Map<string, Array<() => Promise<void>>>();
  /** In-flight steer dispatches awaiting their initial native user message_start. */
  private readonly pendingSteerCounts = new Map<string, number>();

  constructor(private readonly host: PiRuntimeAdapterHost) {}

  /** Maintained for backward compatibility with continuation/launch helpers. */
  expectDirectUserPrompt(_sessionId: string): void {}

  /** Maintained for backward compatibility with continuation/launch helpers. */
  cancelDirectUserPrompt(_sessionId: string): void {}

  resetNativeDispatch(sessionId: string): void {
    this.pendingSteerCounts.delete(sessionId);
    try {
      this.host.activeSessions.get(sessionId)?.piSession.clearQueue?.();
    } catch {
      // Ignore cleanup errors when clearing Pi queue state.
    }
  }

  onNativeUserMessageStart(sessionId: string, active: ActivePiSession): void {
    const steerCount = this.pendingSteerCounts.get(sessionId) ?? 0;
    if (steerCount > 0) {
      if (steerCount === 1) {
        this.pendingSteerCounts.delete(sessionId);
      } else {
        this.pendingSteerCounts.set(sessionId, steerCount - 1);
      }
      return;
    }

    const nextPending = this.pendingMessageQueue.findNextPending(
      sessionId,
      CoworkQueueDelivery.FollowUp,
    );
    if (!nextPending) {
      // Direct prompt: already persisted to SQLite before dispatching to Pi.
      return;
    }
    const item = this.pendingMessageQueue.take(
      sessionId,
      nextPending.id,
      CoworkQueueDelivery.FollowUp,
    );
    if (!item) return;
    this.emitQueueUpdated(sessionId);
    active.summaryCheckpointGoal = item.text;
    const payload = this.buildQueuedPromptPayload(active, item);
    this.host.recovery.recordImagePrompt(sessionId, active, item.text, payload);
    this.persistQueuedUserMessage(sessionId, item, CoworkQueueDelivery.FollowUp);
    this.pendingMessageQueue.finishDelivery(item.id);
  }

  hasPendingFollowUp(sessionId: string): boolean {
    return this.pendingMessageQueue.hasPendingFollowUp(sessionId);
  }

  hasQueuedControlActions(sessionId: string): boolean {
    return (this.queuedControlActions.get(sessionId)?.length ?? 0) > 0;
  }

  dropControlActions(sessionId: string): boolean {
    return this.queuedControlActions.delete(sessionId);
  }

  list(sessionId: string): CoworkPendingMessage[] {
    return this.pendingMessageQueue.list(sessionId);
  }

  /** Clear a deleted session's queue, emitting queueUpdated when it had items. */
  clear(sessionId: string): boolean {
    this.pendingSteerCounts.delete(sessionId);
    this.resetNativeDispatch(sessionId);
    const cleared = this.pendingMessageQueue.clear(sessionId);
    if (cleared) this.emitQueueUpdated(sessionId);
    return cleared;
  }

  /** Deliver the next queued follow-up after a stop settled the queue check. */
  resumeNextFollowUp(sessionId: string): void {
    const next = this.pendingMessageQueue.findNextPending(sessionId, CoworkQueueDelivery.FollowUp);
    if (next) void this.followUpPendingMessage(sessionId, next.id);
  }

  /**
   * Adds an application-owned action after already queued Work prompts. The
   * callback is never persisted and never reaches the model.
   */
  enqueueControlAction(
    sessionId: string,
    action: () => Promise<void>,
  ): { success: boolean; error?: string } {
    const active = this.host.activeSessions.get(sessionId);
    if (!active || active.aborted) {
      return { success: false, error: 'The local coding session is not active.' };
    }
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Control actions require a Work session.' };
    }
    const actions = this.queuedControlActions.get(sessionId) ?? [];
    actions.push(action);
    this.queuedControlActions.set(sessionId, actions);
    if (!active.isRunning) void this.flushFollowUpQueue(sessionId, active);
    return { success: true };
  }

  enqueuePendingMessage(
    sessionId: string,
    text: string,
    imageAttachments?: PiContinueOptions['imageAttachments'],
    fileAttachments?: PiContinueOptions['fileAttachments'],
    skillIds?: string[],
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const active = this.host.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!active || !this.host.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is not running.' };
    }
    const normalizedText = text.trim();
    if (!hasVisiblePromptContent(normalizedText))
      return { success: false, error: 'Message text is required.' };
    // IPC enqueue already persists; IM/internal callers still pass base64 here.
    const storedImages = this.host.persistImageAttachments(sessionId, imageAttachments);
    const item = this.pendingMessageQueue.enqueue(
      sessionId,
      normalizedText,
      CoworkQueueDelivery.FollowUp,
      storedImages,
      fileAttachments,
      skillIds,
    );
    this.emitQueueUpdated(sessionId);
    this.applyQueuedSkillIds(active, item.skillIds);

    const payload = this.buildQueuedPromptPayload(active, item);
    void sendPiPrompt(active.piSession, payload, 'followUp').catch(error => {
      if (
        this.host.activeSessions.get(sessionId) !== active ||
        active.aborted ||
        active.abortController.signal.aborted
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const taken = this.pendingMessageQueue.take(sessionId, item.id, CoworkQueueDelivery.FollowUp);
      if (!taken) return;
      this.pendingMessageQueue.restore(sessionId, { ...taken, error: message });
      this.emitQueueUpdated(sessionId);
    });

    return { success: true, item };
  }

  updatePendingMessage(
    sessionId: string,
    itemId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const active = this.host.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    const normalizedText = text.trim();
    if (!hasVisiblePromptContent(normalizedText))
      return { success: false, error: 'Message text is required.' };
    const item = this.pendingMessageQueue.update(sessionId, itemId, normalizedText);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    this.syncNativeFollowUpQueue(sessionId, active);
    return { success: true, item };
  }

  deletePendingMessage(sessionId: string, itemId: string): { success: boolean; error?: string } {
    const active = this.host.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!this.pendingMessageQueue.remove(sessionId, itemId)) {
      return { success: false, error: 'Pending message was not found.' };
    }
    this.emitQueueUpdated(sessionId);
    this.syncNativeFollowUpQueue(sessionId, active);
    return { success: true };
  }

  async steerPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    const active = this.host.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!active || !this.host.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is not running.' };
    }
    // A queued message is initially classified as FollowUp, but the user can
    // explicitly promote any pending item to an immediate Steer.
    const item = this.pendingMessageQueue.take(sessionId, itemId);
    if (!item) return { success: false, error: 'Pending message was not found.' };

    this.emitQueueUpdated(sessionId);
    this.applyQueuedSkillIds(active, item.skillIds);

    this.pendingSteerCounts.set(sessionId, (this.pendingSteerCounts.get(sessionId) ?? 0) + 1);

    try {
      // Clear native queue first
      try {
        active.piSession.clearQueue?.();
      } catch {
        // Ignore clear queue errors
      }

      const queuedImagePrompt = this.buildQueuedPromptPayload(active, item);
      this.host.recovery.recordImagePrompt(sessionId, active, item.text, queuedImagePrompt);

      await sendPiPrompt(active.piSession, queuedImagePrompt, 'steer');

      this.persistQueuedUserMessage(sessionId, item, CoworkQueueDelivery.Steer);
      active.isRunning = true;
      active.summaryCheckpointGoal = item.text;
      this.pendingMessageQueue.finishDelivery(item.id);

      // Re-enqueue remaining follow-ups preserving attachments
      this.reEnqueueRemainingFollowUps(sessionId, active);

      return { success: true, item };
    } catch (error) {
      const current = this.pendingSteerCounts.get(sessionId) ?? 0;
      if (current <= 1) {
        this.pendingSteerCounts.delete(sessionId);
      } else {
        this.pendingSteerCounts.set(sessionId, current - 1);
      }
      const message = error instanceof Error ? error.message : String(error);
      const restored = this.pendingMessageQueue.restore(sessionId, { ...item, error: message });
      this.emitQueueUpdated(sessionId);
      this.reEnqueueRemainingFollowUps(sessionId, active);
      return { success: false, item: restored, error: message };
    }
  }

  async followUpPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    const active = this.host.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!this.host.isSessionActive(sessionId)) {
      return { success: false, error: 'The Work session is not active.' };
    }
    if (this.host.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is still running.' };
    }
    const item = this.pendingMessageQueue.take(sessionId, itemId, CoworkQueueDelivery.FollowUp);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    try {
      // The queued turn keeps the session's skills and adds its own picks; only
      // the picks belong on the user message.
      const activeSession = this.host.activeSessions.get(sessionId);
      await this.host.continueSession(sessionId, item.text, {
        sessionMode: CoworkSessionMode.Work,
        _queueDelivery: CoworkQueueDelivery.FollowUp,
        _streamingBehavior: 'followUp',
        imageAttachments: item.imageAttachments,
        fileAttachments: item.fileAttachments,
        skillIds: mergeSkillIds(activeSession?.resourceState.skillIds, item.skillIds),
        attachedSkillIds: item.skillIds,
      });
      this.pendingMessageQueue.finishDelivery(item.id);
      return { success: true, item };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const restored = this.pendingMessageQueue.restore(sessionId, { ...item, error: message });
      this.emitQueueUpdated(sessionId);
      return { success: false, item: restored, error: message };
    }
  }

  async flushFollowUpQueue(sessionId: string, active: ActivePiSession): Promise<void> {
    if (active.queueFlushInFlight || active.aborted) return;
    if (active.pendingError || active.turnFailed) {
      // A failed turn never drains work, so a control action queued behind it
      // would otherwise run after an unrelated later turn. Drop it instead.
      if (this.queuedControlActions.delete(sessionId)) {
        console.warn('[PiRuntime] dropped queued control actions after the turn failed');
      }
      return;
    }
    if (active.resourceState.chatMode) return;
    active.queueFlushInFlight = true;
    let retryAfterFailure = false;
    try {
      if (active.aborted || active.isRunning) return;
      const next = this.pendingMessageQueue.takeNext(sessionId, CoworkQueueDelivery.FollowUp);
      if (!next) {
        // Control actions wait behind queued user prompts, and a single flush
        // runs one of them at a time for the same reason.
        const action = this.queuedControlActions.get(sessionId)?.shift();
        if (!action) return;
        if (this.queuedControlActions.get(sessionId)?.length === 0) {
          this.queuedControlActions.delete(sessionId);
        }
        try {
          await action();
        } catch (error) {
          console.error('[PiRuntime] queued control action failed:', error);
        }
        return;
      }
      this.emitQueueUpdated(sessionId);
      try {
        await this.host.continueSession(sessionId, next.text, {
          sessionMode: CoworkSessionMode.Work,
          _queueDelivery: CoworkQueueDelivery.FollowUp,
          _streamingBehavior: 'followUp',
          imageAttachments: next.imageAttachments,
          fileAttachments: next.fileAttachments,
          skillIds: mergeSkillIds(active.resourceState.skillIds, next.skillIds),
          attachedSkillIds: next.skillIds,
        });
        this.pendingMessageQueue.finishDelivery(next.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingMessageQueue.restore(sessionId, { ...next, error: message });
        this.emitQueueUpdated(sessionId);
        console.error('[PiRuntime] queued follow-up failed:', error);
        retryAfterFailure = true;
      }
    } finally {
      active.queueFlushInFlight = false;
      const hasNextFollowUp =
        this.pendingMessageQueue.hasPendingFollowUp(sessionId) ||
        (this.queuedControlActions.get(sessionId)?.length ?? 0) > 0;
      if (
        (retryAfterFailure || hasNextFollowUp) &&
        this.host.activeSessions.get(sessionId) === active &&
        !active.aborted &&
        !active.isRunning
      ) {
        void this.flushFollowUpQueue(sessionId, active);
      }
    }
  }

  private isWorkSession(sessionId: string, active: ActivePiSession | undefined): boolean {
    if (active) return !active.resourceState.chatMode;
    return this.host.isStoredSessionWorkMode(sessionId);
  }

  private buildQueuedPromptPayload(active: ActivePiSession, item: CoworkPendingMessage) {
    return preparePiPrompt(
      item.text,
      item.imageAttachments,
      this.host.recovery.imageInputVerdictForActive(active),
      this.host.getOcrCommandFor(),
      collectImagePathReferences(item.fileAttachments),
    );
  }

  private applyQueuedSkillIds(active: ActivePiSession, skillIds?: string[]): void {
    const mergedSkillIds = mergeSkillIds(active.resourceState.skillIds, skillIds);
    if (haveSameStringList(mergedSkillIds, active.resourceState.skillIds)) return;
    active.resourceState.skillIds = mergedSkillIds;
    active.resourceState.skillRoots = resolvePiSkillRoots(
      mergedSkillIds,
      resolveZhiyuanSkillDirs(),
      active.resourceState.expertSkillDirs,
    );
    active.requestedSkillIds = mergedSkillIds;
    // Defer `piSession.reload()` until idle; Pi refuses reload() while streaming.
    active.pendingSkillReload = true;
  }

  private reEnqueueRemainingFollowUps(sessionId: string, active: ActivePiSession): void {
    const remaining = this.pendingMessageQueue
      .list(sessionId)
      .filter(
        entry =>
          entry.delivery === CoworkQueueDelivery.FollowUp &&
          entry.status === CoworkQueueItemStatus.Pending,
      );
    for (const pending of remaining) {
      const payload = this.buildQueuedPromptPayload(active, pending);
      void sendPiPrompt(active.piSession, payload, 'followUp').catch(err => {
        console.warn(`[PiRuntime] failed to re-enqueue follow-up for ${sessionId}:`, err);
      });
    }
  }

  private syncNativeFollowUpQueue(sessionId: string, active: ActivePiSession | undefined): void {
    if (!active || !this.host.isSessionRunning(sessionId)) return;
    try {
      active.piSession.clearQueue?.();
    } catch (e) {
      console.warn(`[PiRuntime] failed to clear native queue for ${sessionId}:`, e);
    }
    this.reEnqueueRemainingFollowUps(sessionId, active);
  }

  private persistQueuedUserMessage(
    sessionId: string,
    item: CoworkPendingMessage,
    delivery: CoworkQueueDelivery,
  ): CoworkMessage {
    const message: CoworkMessage = {
      id: randomUUID(),
      type: 'user',
      content: item.text,
      timestamp: Date.now(),
      metadata: {
        queueDelivery: delivery,
        ...(item.skillIds?.length ? { skillIds: item.skillIds } : {}),
        ...(item.imageAttachments?.length ? { imageAttachments: item.imageAttachments } : {}),
        ...(item.fileAttachments?.length ? { fileAttachments: item.fileAttachments } : {}),
      },
    };
    const store = this.host.getStore();
    const persisted = store ? store.addMessage(sessionId, message) : message;
    this.host.emit('message', sessionId, persisted);
    return persisted;
  }

  private emitQueueUpdated(sessionId: string): void {
    this.host.emit('queueUpdated', sessionId, this.pendingMessageQueue.list(sessionId));
  }
}
