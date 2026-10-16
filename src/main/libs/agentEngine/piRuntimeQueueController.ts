/**
 * Pending-message queue and control-action runtime for the Pi adapter.
 *
 * Extracted from PiRuntimeAdapter: owns the Cowork pending Work-message queue
 * and the application-owned control actions that run after queued prompts
 * settle. Follow-ups are delivered when the running turn ends; steers land in
 * the live turn; control actions never reach the model or the transcript.
 */

import { randomUUID } from 'crypto';

import {
  CoworkQueueDelivery,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { hasVisiblePromptContent } from '../../../shared/cowork/submissionContent';
import { WorkbenchContractKind } from '../../../shared/workbenchTask';
import type { CoworkMessage } from '../../coworkStore';
import { PiPendingMessageQueue } from './piPendingMessageQueue';
import { applyPiCompactionOverrides, applyPiShellOverride } from './piRuntimeSettingsOverrides';
import {
  haveSameStringList,
  mergeSkillIds,
  preparePiPrompt,
  sendPiPrompt,
  type ActivePiSession,
} from './piRuntimeSessionState';
import type { PiContinueOptions, PiStartOptions } from './piRuntimeTypes';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { collectImagePathReferences } from './piImageInputFallback';

export class PiRuntimeQueueController {
  private readonly pendingMessageQueue = new PiPendingMessageQueue();
  /** Opaque application actions that run after queued Work prompts settle. */
  private readonly queuedControlActions = new Map<string, Array<() => Promise<void>>>();

  constructor(private readonly host: PiRuntimeAdapterHost) {}

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
    return { success: true, item };
  }

  updatePendingMessage(
    sessionId: string,
    itemId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    if (!this.isWorkSession(sessionId, this.host.activeSessions.get(sessionId))) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    const normalizedText = text.trim();
    if (!hasVisiblePromptContent(normalizedText))
      return { success: false, error: 'Message text is required.' };
    const item = this.pendingMessageQueue.update(sessionId, itemId, normalizedText);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    return { success: true, item };
  }

  deletePendingMessage(sessionId: string, itemId: string): { success: boolean; error?: string } {
    if (!this.isWorkSession(sessionId, this.host.activeSessions.get(sessionId))) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!this.pendingMessageQueue.remove(sessionId, itemId)) {
      return { success: false, error: 'Pending message was not found.' };
    }
    this.emitQueueUpdated(sessionId);
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
    // A steer lands in the running session, so its picks must be loaded before
    // the prompt is sent: Pi filters both <available_skills> and the
    // run_skill_script whitelist from the session's skill set, and a skill
    // attached to this queued input is additive exactly like a follow-up's.
    const previousSkillIds = active.resourceState.skillIds;
    const steeredSkillIds = mergeSkillIds(previousSkillIds, item.skillIds);
    if (!haveSameStringList(steeredSkillIds, previousSkillIds)) {
      active.resourceState.skillIds = steeredSkillIds;
      try {
        // Pi reloads the existing ResourceLoader without replacing transcript
        // state, model, MCP tools, or custom expert tools.
        await active.piSession.reload();
        // AgentSession.reload() reloads SettingsManager from disk, so restore
        // the per-process bundled PortableGit override after every reload.
        applyPiShellOverride(active.settingsManager);
        applyPiCompactionOverrides(
          active.settingsManager,
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
          active.modelCompactionOverride,
        );
        active.requestedSkillIds = steeredSkillIds;
      } catch (error) {
        active.resourceState.skillIds = previousSkillIds;
        throw error;
      }
    }
    try {
      const queuedImagePrompt = preparePiPrompt(
        item.text,
        item.imageAttachments,
        this.host.recovery.imageInputVerdictForActive(active),
        this.host.getOcrCommandFor(),
        collectImagePathReferences(item.fileAttachments),
      );
      this.host.recovery.recordImagePrompt(sessionId, active, item.text, queuedImagePrompt);
      await sendPiPrompt(active.piSession, queuedImagePrompt, 'steer');
      this.persistQueuedUserMessage(sessionId, item, CoworkQueueDelivery.Steer);
      active.isRunning = true;
      this.pendingMessageQueue.finishDelivery(item.id);
      return { success: true, item };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const restored = this.pendingMessageQueue.restore(sessionId, { ...item, error: message });
      this.emitQueueUpdated(sessionId);
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
    if (active.workbenchContract.kind === WorkbenchContractKind.Chat) return;
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
    if (active) return active.workbenchContract.kind !== WorkbenchContractKind.Chat;
    return this.host.isStoredSessionWorkMode(sessionId);
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
