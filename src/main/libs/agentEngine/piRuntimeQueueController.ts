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
  type ActivePiSession,
  type PiEvent,
} from './piRuntimeSessionState';
import type { PiContinueOptions } from './piRuntimeTypes';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { collectImagePathReferences, type ImagePromptPreparation } from './piImageInputFallback';
import { resolvePiSkillRoots } from './piSkillRoots';
import { resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';

const ScheduledInputError =
  'Interactive messages are unavailable while the scheduled task is running.';

type QueuedFollowUp = { itemId: string; images: ImagePromptPreparation };

export class PiRuntimeQueueController {
  private readonly pendingMessageQueue = new PiPendingMessageQueue();
  /** Opaque application actions that run after queued Work prompts settle. */
  private readonly queuedControlActions = new Map<string, Array<() => Promise<void>>>();
  private readonly nativeFollowUps = new Map<string, WeakMap<object, QueuedFollowUp>>();

  constructor(private readonly host: PiRuntimeAdapterHost) {}

  resetNativeDispatch(sessionId: string): void {
    this.nativeFollowUps.delete(sessionId);
  }

  onNativeUserMessageStart(
    sessionId: string,
    active: ActivePiSession,
    message: NonNullable<PiEvent['message']>,
  ): void {
    const followUps = this.nativeFollowUps.get(sessionId);
    const queued = followUps?.get(message);
    if (!queued) return;
    followUps?.delete(message);
    const item = this.pendingMessageQueue.take(
      sessionId,
      queued.itemId,
      CoworkQueueDelivery.FollowUp,
    );
    if (!item) return;
    this.applyQueuedSkillIds(active, item.skillIds);
    this.persistQueuedSkillIds(sessionId, item.skillIds);
    this.emitQueueUpdated(sessionId);
    active.summaryCheckpointGoal = item.text;
    this.host.recovery.reportOmittedImages(sessionId, queued.images);
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
    if (active.unattended && active.onSettled)
      return { success: false, error: ScheduledInputError };
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
    const skillContext =
      item.skillIds && active.resourceState.describeQueuedSkills?.(item.skillIds);
    // Follow-ups run before Pi can reload the session's ResourceLoader. Keep the
    // selected Skill references on this native input, leaving the current request alone.
    const { content, ...imagePreparation } = this.buildQueuedPromptPayload(
      active,
      item,
      skillContext,
    );
    const textParts =
      typeof content === 'string' ? [] : content.filter(part => part.type === 'text');
    const promptText =
      typeof content === 'string' ? content : textParts.map(part => part.text).join('\n');
    const images =
      typeof content === 'string' ? undefined : content.filter(part => part.type === 'image');
    const followUps = this.nativeFollowUps.get(sessionId) ?? new WeakMap<object, QueuedFollowUp>();
    this.nativeFollowUps.set(sessionId, followUps);
    // followUp queues even during initial prompt preparation, when Pi is still idle.
    void active.piSession
      .followUp(promptText, images, {
        onQueued: message => followUps.set(message, { itemId: item.id, images: imagePreparation }),
      })
      .then(disposition => {
        if (disposition === 'handled')
          throw new Error('The agent handled this input without adding a follow-up.');
      })
      .catch(error => {
        if (
          this.host.activeSessions.get(sessionId) !== active ||
          active.aborted ||
          active.abortController.signal.aborted
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const taken = this.pendingMessageQueue.take(
          sessionId,
          item.id,
          CoworkQueueDelivery.FollowUp,
        );
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
    if (active.unattended && active.onSettled)
      return { success: false, error: ScheduledInputError };
    if (active.resourceState.chatMode || !hasVisiblePromptContent(text)) {
      return { success: false, error: 'Steering requires a Work session and message text.' };
    }
    try {
      const disposition = await active.piSession.steer(text);
      if (disposition === 'queued' && this.host.activeSessions.get(sessionId) === active) {
        this.persistQueuedUserMessage(sessionId, { text }, CoworkQueueDelivery.Steer);
        active.summaryCheckpointGoal = text;
      }
      return { success: true };
    } catch (error) {
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

  private buildQueuedPromptPayload(
    active: ActivePiSession,
    item: CoworkPendingMessage,
    skillContext?: string,
  ) {
    // Keep the first space after a bare /skill command so Pi can still parse it.
    const delimiter = item.text.startsWith('/skill:') && !item.text.includes(' ') ? ' ' : '\n\n';
    return preparePiPrompt(
      skillContext ? `${item.text}${delimiter}${skillContext}` : item.text,
      item.imageAttachments,
      this.host.recovery.imageInputVerdictForActive(active),
      this.host.getOcrCommandFor(),
      collectImagePathReferences(item.fileAttachments),
    );
  }

  private applyQueuedSkillIds(active: ActivePiSession, skillIds?: string[]): void {
    const mergedSkillIds = mergeSkillIds(active.resourceState.skillIds, skillIds);
    if (haveSameStringList(mergedSkillIds, active.resourceState.skillIds)) return;
    const skillRoots = resolvePiSkillRoots(
      mergedSkillIds,
      resolveZhiyuanSkillDirs(),
      active.resourceState.expertSkillDirs,
    );
    if (skillRoots['text-to-cad'] && !active.resourceState.skillRoots['text-to-cad']) {
      active.pendingCadToolReload = true;
    }
    active.resourceState.skillIds = mergedSkillIds;
    active.resourceState.skillRoots = skillRoots;
    active.requestedSkillIds = mergedSkillIds;
    // Defer `piSession.reload()` until idle; Pi refuses reload() while streaming.
    active.pendingSkillReload = true;
  }

  private persistQueuedSkillIds(sessionId: string, skillIds?: string[]): void {
    if (!skillIds?.length) return;
    const store = this.host.getStore();
    const session = store?.getSession(sessionId, 0, { includeArtifacts: false });
    if (!store || !session) return;
    const activeSkillIds = mergeSkillIds(session.activeSkillIds, skillIds) ?? [];
    if (!haveSameStringList(session.activeSkillIds, activeSkillIds)) {
      store.updateSession(sessionId, { activeSkillIds }, { touchUpdatedAt: false });
    }
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
