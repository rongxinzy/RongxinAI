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

  resetNativeDispatch(sessionId: string): void {
    this.pendingSteerCounts.delete(sessionId);
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
    this.host.recovery.reportOmittedImages(sessionId, payload);
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
    if (!active.isRunning) void this.flushControlActions(sessionId, active);
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

  /** A new explicit input goes straight to Pi; accepted inputs are never rebuilt. */
  async steerInput(sessionId: string, text: string): Promise<{ success: boolean; error?: string }> {
    const active = this.host.activeSessions.get(sessionId);
    if (!active || active.aborted || !this.host.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is not running.' };
    }
    if (active.resourceState.chatMode || !hasVisiblePromptContent(text)) {
      return { success: false, error: 'Steering requires a Work session and message text.' };
    }
    this.persistQueuedUserMessage(sessionId, { text }, CoworkQueueDelivery.Steer);
    this.pendingSteerCounts.set(sessionId, (this.pendingSteerCounts.get(sessionId) ?? 0) + 1);
    try {
      await active.piSession.steer(text);
      active.summaryCheckpointGoal = text;
      return { success: true };
    } catch (error) {
      const count = this.pendingSteerCounts.get(sessionId) ?? 0;
      if (count <= 1) this.pendingSteerCounts.delete(sessionId);
      else this.pendingSteerCounts.set(sessionId, count - 1);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async flushControlActions(sessionId: string, active: ActivePiSession): Promise<void> {
    if (active.controlActionInFlight || active.aborted) return;
    if (active.pendingError || active.turnFailed) {
      // A failed turn never drains work, so a control action queued behind it
      // would otherwise run after an unrelated later turn. Drop it instead.
      if (this.queuedControlActions.delete(sessionId)) {
        console.warn('[PiRuntime] dropped queued control actions after the turn failed');
      }
      return;
    }
    if (active.resourceState.chatMode) return;
    active.controlActionInFlight = true;
    try {
      if (active.aborted || active.isRunning) return;
      const action = this.queuedControlActions.get(sessionId)?.shift();
      if (!action) return;
      if (this.queuedControlActions.get(sessionId)?.length === 0) {
        this.queuedControlActions.delete(sessionId);
      }
      try {
        await action();
      } catch (error) {
        console.error(`[PiRuntime] queued control action failed for session ${sessionId}:`, error);
      }
    } finally {
      active.controlActionInFlight = false;
      if (
        this.hasQueuedControlActions(sessionId) &&
        this.host.activeSessions.get(sessionId) === active &&
        !active.aborted &&
        !active.isRunning
      ) {
        void this.flushControlActions(sessionId, active);
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

  private persistQueuedUserMessage(
    sessionId: string,
    item: Pick<CoworkPendingMessage, 'text' | 'skillIds' | 'imageAttachments' | 'fileAttachments'>,
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
