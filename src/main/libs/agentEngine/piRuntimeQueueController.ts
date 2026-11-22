/**
 * Pending-message queue and control-action runtime for the Pi adapter.
 *
 * Extracted from PiRuntimeAdapter: owns the Cowork pending Work-message metadata
 * sidecar and the application-owned control actions that run after queued prompts
 * settle. Native follow-up and steer queues are delegated directly to Pi.
 */

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { hasVisiblePromptContent } from '../../../shared/cowork/submissionContent';
import { PiPendingMessageQueue } from './piPendingMessageQueue';
import {
  haveSameStringList,
  persistPiUserMessage,
  mergeSkillIds,
  preparePiPrompt,
  type ActivePiSession,
  type PiEvent,
  type PreparedPiPrompt,
} from './piRuntimeSessionState';
import type { PiContinueOptions } from './piRuntimeTypes';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { collectImagePathReferences, type ImagePromptPreparation } from './piImageInputFallback';
import { resolvePiSkillRoots } from './piSkillRoots';
import { resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';

const ScheduledInputError =
  'Interactive messages are unavailable while the scheduled task is running.';
const FollowUpEndedError = 'The Work turn ended before Pi accepted this follow-up.';

type QueuedInput = { itemId: string; images: ImagePromptPreparation } | { steerText: string };

export class PiRuntimeQueueController {
  private readonly pendingMessageQueue = new PiPendingMessageQueue();
  /** Opaque application actions that run after queued Work prompts settle. */
  private readonly queuedControlActions = new Map<string, Array<() => Promise<void>>>();
  private readonly nativeInputs = new Map<string, WeakMap<object, QueuedInput>>();
  private readonly pendingImageAdmissions = new Map<string, Promise<void>>();

  constructor(private readonly host: PiRuntimeAdapterHost) {}

  resetNativeDispatch(sessionId: string): void {
    this.nativeInputs.delete(sessionId);
    this.pendingImageAdmissions.delete(sessionId);
  }

  discardRecreatedSessionFollowUps(sessionId: string): void {
    this.resetNativeDispatch(sessionId);
    const pending = this.pendingMessageQueue
      .list(sessionId)
      .filter(item => item.status === CoworkQueueItemStatus.Pending);
    for (const item of pending) {
      this.pendingMessageQueue.restore(sessionId, {
        ...item,
        error: 'The session changed before Pi delivered this follow-up.',
      });
    }
    if (pending.length > 0) this.emitQueueUpdated(sessionId);
  }

  onNativeUserMessageStart(
    sessionId: string,
    active: ActivePiSession,
    message: NonNullable<PiEvent['message']>,
  ): void {
    const inputs = this.nativeInputs.get(sessionId);
    const queued = inputs?.get(message);
    if (!queued) return;
    inputs?.delete(message);
    if ('steerText' in queued) {
      persistPiUserMessage(this.host, sessionId, queued.steerText, {
        queueDelivery: CoworkQueueDelivery.Steer,
      });
      active.summaryCheckpointGoal = queued.steerText;
      return;
    }
    const item = this.pendingMessageQueue.take(
      sessionId,
      queued.itemId,
      CoworkQueueDelivery.FollowUp,
    );
    if (!item) return;
    this.applyQueuedSkillIds(active, item.skillIds);
    if (item.skillIds?.length)
      this.host.getStore(sessionId)?.appendSessionSkills(sessionId, item.skillIds);
    this.emitQueueUpdated(sessionId);
    active.summaryCheckpointGoal = item.text;
    this.host.recovery.reportOmittedImages(sessionId, queued.images);
    persistPiUserMessage(this.host, sessionId, item.text, {
      ...item,
      queueDelivery: CoworkQueueDelivery.FollowUp,
    });
    this.pendingMessageQueue.finishDelivery(item.id);
  }

  hasPendingFollowUp(sessionId: string): boolean {
    return (
      this.pendingImageAdmissions.has(sessionId) ||
      this.pendingMessageQueue.hasPendingFollowUp(sessionId)
    );
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

  async enqueuePendingMessage(
    sessionId: string,
    text: string,
    imageAttachments?: PiContinueOptions['imageAttachments'],
    fileAttachments?: PiContinueOptions['fileAttachments'],
    skillIds?: string[],
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
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
    const submissionToken = active.submissionToken;
    const signal = active.abortController.signal;
    const isCurrent = () =>
      this.host.activeSessions.get(sessionId) === active &&
      active.submissionToken === submissionToken &&
      active.isRunning &&
      !active.aborted &&
      !signal.aborted;
    const previous = this.pendingImageAdmissions.get(sessionId);
    if (!previous && !imageAttachments?.length) {
      return this.enqueueNativeFollowUp(
        sessionId,
        active,
        isCurrent,
        normalizedText,
        undefined,
        fileAttachments,
        skillIds,
      );
    }
    const images = imageAttachments?.length
      ? Promise.allSettled([
          this.host.persistImageAttachments(sessionId, imageAttachments, signal, isCurrent),
        ])
      : undefined;
    const submission = (async () => {
      await previous;
      const ready = (await images)?.[0];
      if (!isCurrent()) return { success: false, error: FollowUpEndedError };
      if (ready?.status === 'rejected') throw ready.reason;
      return this.enqueueNativeFollowUp(
        sessionId,
        active,
        isCurrent,
        normalizedText,
        ready?.status === 'fulfilled' ? ready.value : undefined,
        fileAttachments,
        skillIds,
      );
    })();
    const barrier = submission.then(
      (): void => {},
      (): void => {},
    );
    this.pendingImageAdmissions.set(sessionId, barrier);
    try {
      return await submission;
    } finally {
      if (this.pendingImageAdmissions.get(sessionId) === barrier) {
        this.pendingImageAdmissions.delete(sessionId);
        if (
          this.host.activeSessions.get(sessionId) === active &&
          !active.isRunning &&
          this.hasQueuedControlActions(sessionId)
        ) {
          void this.flushControlActions(sessionId, active);
        }
      }
    }
  }

  private enqueueNativeFollowUp(
    sessionId: string,
    active: ActivePiSession,
    isCurrent: () => boolean,
    normalizedText: string,
    storedImages?: PiContinueOptions['imageAttachments'],
    fileAttachments?: PiContinueOptions['fileAttachments'],
    skillIds?: string[],
  ) {
    const skillContext = skillIds?.length && active.resourceState.describeQueuedSkills?.(skillIds);
    // Keep the first space after a bare /skill command so Pi can still parse it.
    const delimiter =
      normalizedText.startsWith('/skill:') && !normalizedText.includes(' ') ? ' ' : '\n\n';
    const prepared = preparePiPrompt(
      skillContext ? `${normalizedText}${delimiter}${skillContext}` : normalizedText,
      storedImages,
      this.host.recovery.imageInputVerdictForActive(active),
      this.host.getOcrCommandFor(),
      collectImagePathReferences(fileAttachments),
      active.abortController.signal,
    );
    const submit = ({ content, ...imagePreparation }: PreparedPiPrompt) => {
      if (!isCurrent()) return { success: false, error: FollowUpEndedError };
      const item = this.pendingMessageQueue.enqueue(
        sessionId,
        normalizedText,
        CoworkQueueDelivery.FollowUp,
        storedImages,
        fileAttachments,
        skillIds,
      );
      this.emitQueueUpdated(sessionId);
      const textParts =
        typeof content === 'string' ? [] : content.filter(part => part.type === 'text');
      const promptText =
        typeof content === 'string' ? content : textParts.map(part => part.text).join('\n');
      const images =
        typeof content === 'string' ? undefined : content.filter(part => part.type === 'image');
      const inputs = this.nativeInputs.get(sessionId) ?? new WeakMap<object, QueuedInput>();
      this.nativeInputs.set(sessionId, inputs);
      // followUp queues even during initial prompt preparation, when Pi is still idle.
      void active.piSession
        .followUp(promptText, images, {
          onQueued: message => {
            if (!isCurrent() || this.nativeInputs.get(sessionId) !== inputs) {
              throw new Error(FollowUpEndedError);
            }
            inputs.set(message, { itemId: item.id, images: imagePreparation });
          },
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
          void this.flushControlActions(sessionId, active);
        });

      return { success: true, item };
    };
    return prepared instanceof Promise
      ? prepared.then(submit, (error: unknown) => {
          if (!isCurrent()) return { success: false, error: FollowUpEndedError };
          throw error;
        })
      : submit(prepared);
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
      const inputs = this.nativeInputs.get(sessionId) ?? new WeakMap<object, QueuedInput>();
      this.nativeInputs.set(sessionId, inputs);
      await active.piSession.steer(text, undefined, {
        onQueued: message => {
          if (this.nativeInputs.get(sessionId) !== inputs || !active.isRunning) {
            throw new Error('The Work session ended before Pi accepted the steering input.');
          }
          inputs.set(message, { steerText: text });
        },
      });
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
      if (active.aborted || active.isRunning || this.hasPendingFollowUp(sessionId)) return;
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
        !active.isRunning &&
        !this.hasPendingFollowUp(sessionId)
      ) {
        void this.flushControlActions(sessionId, active);
      }
    }
  }

  private isWorkSession(sessionId: string, active: ActivePiSession | undefined): boolean {
    if (active) return !active.resourceState.chatMode;
    return this.host.isStoredSessionWorkMode(sessionId);
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

  private emitQueueUpdated(sessionId: string): void {
    this.host.emit('queueUpdated', sessionId, this.pendingMessageQueue.list(sessionId));
  }
}
