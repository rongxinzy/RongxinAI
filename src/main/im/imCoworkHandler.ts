/**
 * IM Cowork Handler
 * Adapter that routes channel turns through the Pi runtime.
 *
 * The implementation is split into focused modules under ./imCoworkHandler
 * (issue #1069); this module orchestrates them and keeps the public surface:
 *
 * - ./imCoworkHandler/types            – shared accumulator/permission state types
 * - ./imCoworkHandler/sessionRegistry  – IM↔Cowork session mapping lifecycle
 * - ./imCoworkHandler/prompt           – system prompt assembly
 * - ./imCoworkHandler/accumulator      – message accumulation and run projection
 * - ./imCoworkHandler/permissions      – channel permission confirmation flow
 * - ./imCoworkHandler/scheduledTaskTurn– direct cron.add turns
 * - ./imCoworkHandler/turnLauncher     – Pi runtime start/continue dispatch
 * - ./imCoworkHandler/replies          – reply and media formatting helpers
 */

import { EventEmitter } from 'events';

import { type CoworkError } from '../../common/coworkError';
import { ActivitySource, ActivityStatus } from '../../shared/activity/constants';
import type { Platform } from '../../shared/platform';
import type { ActivityService } from '../activity/activityService';
import type { CoworkMessage, CoworkStore } from '../coworkStore';
import { t } from '../i18n';
import type { PermissionRequest, PiRuntime } from '../libs/agentEngine/types';
import { generateCorrelationId, runWithCorrelationId } from '../libs/logCorrelation';
import { IMCoworkAccumulatorRegistry } from './imCoworkHandler/accumulator';
import {
  accumulatorFromPendingPermissions,
  buildIMAllowPermissionResult,
  buildIMPermissionPrompt,
  createIMConversationKey,
  IMCoworkPermissionRegistry,
  isIMAllowResponse,
  isIMDenyResponse,
} from './imCoworkHandler/permissions';
import { buildIMCoworkSystemPrompt } from './imCoworkHandler/prompt';
import {
  formatIMErrorReply,
  formatIMMessageWithMedia,
  formatIMReply,
  formatIMReplyRaw,
} from './imCoworkHandler/replies';
import { runIMDirectScheduledTaskTurn } from './imCoworkHandler/scheduledTaskTurn';
import { IMCoworkSessionRegistry } from './imCoworkHandler/sessionRegistry';
import { launchIMCoworkRuntimeTurn } from './imCoworkHandler/turnLauncher';
import { toPiAttachments } from './imPiAttachments';
import {
  isReminderSystemTurn,
  type IMScheduledTaskCreationResult,
  type IMScheduledTaskRequestDetector,
  type ParsedIMScheduledTaskRequest,
} from './imScheduledTaskHandler';
import type { IMStore } from './imStore';
import type { IMMessage } from './types';

export interface IMCoworkHandlerOptions {
  coworkRuntime: PiRuntime;
  coworkStore: CoworkStore;
  imStore: IMStore;
  getSkillsPrompt?: () => Promise<string | null>;
  detectScheduledTaskRequest?: IMScheduledTaskRequestDetector;
  createScheduledTask?: (params: {
    sessionId: string;
    message: IMMessage;
    request: ParsedIMScheduledTaskRequest;
  }) => Promise<IMScheduledTaskCreationResult>;
  sendAsyncReply?: (platform: Platform, conversationId: string, text: string) => Promise<boolean>;
  activityService?: ActivityService;
}

export class IMCoworkHandler extends EventEmitter {
  private coworkRuntime: PiRuntime;
  private coworkStore: CoworkStore;
  private imStore: IMStore;
  private getSkillsPrompt?: () => Promise<string | null>;
  private detectScheduledTaskRequest?: IMScheduledTaskRequestDetector;
  private createScheduledTask?: (params: {
    sessionId: string;
    message: IMMessage;
    request: ParsedIMScheduledTaskRequest;
  }) => Promise<IMScheduledTaskCreationResult>;
  private sendAsyncReply?: (
    platform: Platform,
    conversationId: string,
    text: string,
  ) => Promise<boolean>;
  private activityService?: ActivityService;

  private readonly sessionRegistry: IMCoworkSessionRegistry;
  private readonly messageAccumulators: IMCoworkAccumulatorRegistry;
  private readonly permissions: IMCoworkPermissionRegistry;

  private readonly onMessage = this.handleMessage.bind(this);
  private readonly onMessageUpdate = this.handleMessageUpdate.bind(this);
  private readonly onPermissionRequest = this.handlePermissionRequest.bind(this);
  private readonly onComplete = this.handleComplete.bind(this);
  private readonly onError = this.handleError.bind(this);
  private readonly onSessionStopped = this.handleSessionStopped.bind(this);

  constructor(options: IMCoworkHandlerOptions) {
    super();
    this.coworkRuntime = options.coworkRuntime;
    this.coworkStore = options.coworkStore;
    this.imStore = options.imStore;
    this.getSkillsPrompt = options.getSkillsPrompt;
    this.detectScheduledTaskRequest = options.detectScheduledTaskRequest;
    this.createScheduledTask = options.createScheduledTask;
    this.sendAsyncReply = options.sendAsyncReply;
    this.activityService = options.activityService;

    this.permissions = new IMCoworkPermissionRegistry();
    this.sessionRegistry = new IMCoworkSessionRegistry({
      coworkRuntime: this.coworkRuntime,
      coworkStore: this.coworkStore,
      imStore: this.imStore,
      buildSystemPrompt: () => this.buildSystemPromptWithSkills(),
      onSessionInvalidated: coworkSessionId => {
        this.permissions.clearBySessionId(coworkSessionId);
      },
    });
    this.messageAccumulators = new IMCoworkAccumulatorRegistry({
      coworkStore: this.coworkStore,
      activityService: this.activityService,
      getConversation: sessionId => this.sessionRegistry.getConversation(sessionId),
      stopSession: sessionId => this.coworkRuntime.stopSession(sessionId),
    });

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for Pi runtime events.
   */
  private setupEventListeners(): void {
    this.coworkRuntime.on('message', this.onMessage);
    this.coworkRuntime.on('messageUpdate', this.onMessageUpdate);
    this.coworkRuntime.on('permissionRequest', this.onPermissionRequest);
    this.coworkRuntime.on('complete', this.onComplete);
    this.coworkRuntime.on('error', this.onError);
    this.coworkRuntime.on('sessionStopped', this.onSessionStopped);
  }

  /**
   * Process an incoming IM message using the Pi runtime.
   */
  async processMessage(
    message: IMMessage,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<string> {
    const pendingPermissionReply = await this.handlePendingPermissionReply(message);
    if (pendingPermissionReply !== null) {
      return pendingPermissionReply;
    }

    try {
      return await this.processMessageInternal(message, false, signal, workspaceId);
    } catch (error) {
      if (!this.isSessionNotFoundError(error)) {
        throw error;
      }

      console.warn(
        `[IMCoworkHandler] Cowork session mapping is stale for ${message.platform}:${message.conversationId}, recreating session`,
      );
      return this.processMessageInternal(message, true, signal, workspaceId);
    }
  }

  private async processMessageInternal(
    message: IMMessage,
    forceNewSession: boolean,
    signal?: AbortSignal,
    workspaceId?: string,
  ): Promise<string> {
    const cid = generateCorrelationId();
    return runWithCorrelationId(cid, async () => {
      const coworkSessionId = await this.sessionRegistry.getOrCreateSession(
        message.conversationId,
        message.platform,
        forceNewSession,
        workspaceId,
      );
      this.sessionRegistry.setConversation(coworkSessionId, {
        conversationId: message.conversationId,
        platform: message.platform,
      });

      const formattedContent = formatIMMessageWithMedia(message);
      const piAttachments = await toPiAttachments(message.attachments);
      const directScheduledTaskRequest =
        this.createScheduledTask && this.detectScheduledTaskRequest
          ? await this.detectScheduledTaskRequest(message)
          : null;

      if (directScheduledTaskRequest && this.createScheduledTask) {
        return runIMDirectScheduledTaskTurn(
          { coworkStore: this.coworkStore, createScheduledTask: this.createScheduledTask },
          coworkSessionId,
          message,
          formattedContent,
          directScheduledTaskRequest,
        );
      }

      const responsePromise = this.messageAccumulators.createResponsePromise(coworkSessionId, cid);
      const cancelTurn = () => {
        const accumulator = this.messageAccumulators.get(coworkSessionId);
        if (!accumulator || accumulator.runId !== cid) return;
        this.messageAccumulators.cleanup(coworkSessionId);
        this.coworkRuntime.stopSession(coworkSessionId);
        this.messageAccumulators.emitRunEvent(
          coworkSessionId,
          accumulator,
          ActivityStatus.Failed,
          undefined,
          'Channel request was cancelled',
        );
        accumulator.reject?.(new Error('Channel request was cancelled'));
      };
      if (signal?.aborted) cancelTurn();
      else signal?.addEventListener('abort', cancelTurn, { once: true });

      if (signal?.aborted) {
        return await responsePromise;
      }

      this.activityService?.upsertBestEffort({
        id: cid,
        source: ActivitySource.Channel,
        status: ActivityStatus.Running,
        sessionId: coworkSessionId,
        platform: message.platform,
        conversationId: message.conversationId,
        inputPreview: formattedContent,
      });

      const onSessionStartError = (error: unknown) => {
        this.messageAccumulators.reject(
          coworkSessionId,
          error instanceof Error ? error : new Error(String(error)),
        );
      };

      try {
        await launchIMCoworkRuntimeTurn(
          {
            coworkRuntime: this.coworkRuntime,
            coworkStore: this.coworkStore,
            buildSystemPrompt: () => this.buildSystemPromptWithSkills(),
          },
          {
            sessionId: coworkSessionId,
            platform: message.platform,
            conversationId: message.conversationId,
            prompt: formattedContent,
            attachments: piAttachments,
            signal,
          },
          onSessionStartError,
        );
      } catch (error) {
        onSessionStartError(error);
      }

      try {
        return await responsePromise;
      } finally {
        signal?.removeEventListener('abort', cancelTurn);
      }
    });
  }

  private async buildSystemPromptWithSkills(): Promise<string> {
    return buildIMCoworkSystemPrompt({
      coworkStore: this.coworkStore,
      imStore: this.imStore,
      getSkillsPrompt: this.getSkillsPrompt,
    });
  }

  private isSessionNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /^Session\s.+\snot found$/i.test(message.trim());
  }

  /**
   * Handle a message event from the Pi runtime.
   */
  private handleMessage(sessionId: string, message: CoworkMessage): void {
    // Only process messages from IM sessions
    const tracked = this.sessionRegistry.ensureTrackedSession(sessionId);
    console.log(
      '[IMCoworkHandler:handleMessage] sessionId:',
      sessionId,
      'tracked:',
      tracked,
      'messageType:',
      message.type,
    );
    if (!tracked) return;

    let accumulator = this.messageAccumulators.get(sessionId);
    if (!accumulator) {
      accumulator = this.messageAccumulators.ensureBackgroundAccumulator(sessionId, message);
    }
    if (accumulator) {
      accumulator.messages.push(message);
    }
  }

  /**
   * Handle message update event (streaming content)
   */
  private handleMessageUpdate(sessionId: string, messageId: string, content: string): void {
    // Only process updates from IM sessions
    if (!this.sessionRegistry.ensureTrackedSession(sessionId)) return;

    const accumulator = this.messageAccumulators.get(sessionId);
    if (accumulator) {
      // Update the message content in the accumulator
      const existingIndex = accumulator.messages.findIndex(m => m.id === messageId);
      if (existingIndex >= 0) {
        accumulator.messages[existingIndex].content = content;
      }
    }
  }

  private async handlePendingPermissionReply(message: IMMessage): Promise<string | null> {
    const key = createIMConversationKey(message.conversationId, message.platform);
    const pending = this.permissions.get(key);
    if (!pending) return null;

    const normalizedReply = message.content.trim().replace(/[。！!,.，\s]+$/g, '');
    if (!normalizedReply) {
      return '当前有待确认操作，请回复“允许”或“拒绝”（60 秒内）。';
    }

    if (!this.coworkRuntime.isSessionActive(pending.sessionId)) {
      this.permissions.clearByKey(key);
      this.messageAccumulators.emitRunEvent(
        pending.sessionId,
        {
          runId: pending.runId,
          messages: [],
          backgroundDelivery: pending.backgroundDelivery,
        },
        ActivityStatus.Failed,
        undefined,
        '该确认请求已过期，请重新发送任务。',
      );
      return '该确认请求已过期，请重新发送任务。';
    }

    if (isIMDenyResponse(normalizedReply)) {
      this.permissions.clearByKey(key);
      this.coworkRuntime.respondToPermission(pending.request.requestId, {
        behavior: 'deny',
        message: 'Operation denied by IM user confirmation.',
      });
      this.messageAccumulators.emitRunEvent(
        pending.sessionId,
        {
          runId: pending.runId,
          messages: [],
          backgroundDelivery: pending.backgroundDelivery,
        },
        ActivityStatus.Failed,
        undefined,
        '已拒绝本次操作，任务未继续执行。',
      );
      return '已拒绝本次操作，任务未继续执行。';
    }

    if (!isIMAllowResponse(normalizedReply)) {
      return '当前有待确认操作，请回复“允许”或“拒绝”（60 秒内）。';
    }

    this.permissions.clearByKey(key);
    const responsePromise = this.messageAccumulators.createResponsePromise(
      pending.sessionId,
      pending.runId,
      pending.backgroundDelivery,
    );
    this.coworkRuntime.respondToPermission(
      pending.request.requestId,
      buildIMAllowPermissionResult(pending.request),
    );
    return responsePromise;
  }

  /**
   * Handle permission request in IM mode with explicit user confirmation.
   */
  private handlePermissionRequest(sessionId: string, request: PermissionRequest): void {
    // Only process permission requests from IM sessions
    if (!this.sessionRegistry.ensureTrackedSession(sessionId)) return;
    const conversation = this.sessionRegistry.getConversation(sessionId);
    if (!conversation) {
      this.coworkRuntime.respondToPermission(request.requestId, {
        behavior: 'deny',
        message: 'IM session mapping missing for permission request.',
      });
      return;
    }

    const key = createIMConversationKey(conversation.conversationId, conversation.platform);
    const existingPending = this.permissions.clearByKey(key);
    if (existingPending) {
      this.coworkRuntime.respondToPermission(existingPending.request.requestId, {
        behavior: 'deny',
        message: 'Superseded by a newer permission request.',
      });
    }

    const accumulator = this.messageAccumulators.get(sessionId);
    const runId = accumulator?.runId ?? existingPending?.runId ?? generateCorrelationId();
    const backgroundDelivery =
      accumulator?.backgroundDelivery ?? existingPending?.backgroundDelivery;

    this.permissions.track(
      {
        key,
        runId,
        sessionId,
        request,
        conversationId: conversation.conversationId,
        platform: conversation.platform,
        backgroundDelivery,
      },
      currentPending => {
        this.coworkRuntime.respondToPermission(request.requestId, {
          behavior: 'deny',
          message: 'Permission request timed out after 60s',
        });
        this.messageAccumulators.emitRunEvent(
          currentPending.sessionId,
          {
            runId: currentPending.runId,
            messages: [],
            backgroundDelivery: currentPending.backgroundDelivery,
          },
          ActivityStatus.Failed,
          undefined,
          '确认请求等待超时，任务未继续执行。',
        );
      },
    );

    if (accumulator) {
      const confirmationPrompt = buildIMPermissionPrompt(request);
      this.messageAccumulators.cleanup(sessionId);
      accumulator.resolve?.(confirmationPrompt);
    }
  }

  /**
   * Handle session complete event
   */
  private handleComplete(sessionId: string): void {
    // Only process complete events from IM sessions
    const tracked = this.sessionRegistry.ensureTrackedSession(sessionId);
    console.log(
      '[IMCoworkHandler:handleComplete] sessionId:',
      sessionId,
      'tracked:',
      tracked,
      'hasAccumulator:',
      this.messageAccumulators.has(sessionId),
    );
    if (!tracked) return;

    const pendingPermissions = this.permissions.clearBySessionId(sessionId);
    const accumulator =
      this.messageAccumulators.get(sessionId) ??
      accumulatorFromPendingPermissions(pendingPermissions);
    if (!accumulator) {
      return;
    }

    // Use reconciled messages from the store (authoritative after reconcileWithHistory)
    // instead of accumulator messages which may be stale streaming snapshots.
    // Fall back to accumulator messages if the store has none (e.g. timeout path).
    const session = this.coworkStore.getSession(sessionId);
    const storeMessages = session?.messages ?? [];
    const currentTurnStoreMessages = storeMessages.slice(
      accumulator.storeMessageCountAtStart ?? storeMessages.length,
    );
    const messages =
      currentTurnStoreMessages.length > 0 ? currentTurnStoreMessages : accumulator.messages;

    // For cron-triggered background deliveries (scheduled task executions),
    // skip the reminder guard — the assistant text IS the scheduled reminder
    // itself, not a promise to create one.
    const replyText = accumulator.backgroundDelivery
      ? formatIMReplyRaw(messages)
      : formatIMReply(sessionId, messages);

    console.log(
      `[IMCoworkHandler] 会话完成:`,
      JSON.stringify(
        {
          sessionId,
          messageCount: messages.length,
          replyLength: replyText.length,
          reply: replyText,
          backgroundDelivery: accumulator.backgroundDelivery ?? null,
          usedStoreMessages: currentTurnStoreMessages.length > 0,
        },
        null,
        2,
      ),
    );

    this.messageAccumulators.cleanup(sessionId);

    this.messageAccumulators.emitRunEvent(
      sessionId,
      accumulator,
      ActivityStatus.Completed,
      replyText,
    );

    if (accumulator.backgroundDelivery) {
      if (!this.sendAsyncReply || !replyText || replyText === '处理完成，但没有生成回复。') {
        console.warn('[IMCoworkHandler] cannot send async IM reminder reply', replyText);
        return;
      }
      if (!isReminderSystemTurn(messages)) {
        console.log('[IMCoworkHandler] not a reminder system turn, skipping async reply');
        return;
      }
      void this.sendAsyncReply(
        accumulator.backgroundDelivery.platform,
        accumulator.backgroundDelivery.conversationId,
        replyText,
      )
        .then(sent => {
          if (!sent) {
            console.warn(
              '[IMCoworkHandler] Failed to relay async IM reminder reply',
              JSON.stringify({
                sessionId,
                platform: accumulator.backgroundDelivery?.platform,
                conversationId: accumulator.backgroundDelivery?.conversationId,
              }),
            );
          }
        })
        .catch(error => {
          console.error('[IMCoworkHandler] Async IM reminder reply failed:', error);
        });
      return;
    }

    accumulator.resolve?.(replyText);
  }

  /**
   * Handle session error event
   */
  private handleError(sessionId: string, error: CoworkError): void {
    // Only process error events from IM sessions
    if (!this.sessionRegistry.ensureTrackedSession(sessionId)) return;

    const pendingPermissions = this.permissions.clearBySessionId(sessionId);
    const accumulator =
      this.messageAccumulators.get(sessionId) ??
      accumulatorFromPendingPermissions(pendingPermissions);
    if (!accumulator) return;

    // Generate differentiated IM reply based on error kind
    const replyText = formatIMErrorReply(error);
    this.messageAccumulators.cleanup(sessionId);

    this.messageAccumulators.emitRunEvent(
      sessionId,
      accumulator,
      ActivityStatus.Failed,
      undefined,
      replyText,
    );

    accumulator.reject?.(new Error(replyText));
  }

  private handleSessionStopped(sessionId: string): void {
    if (!this.sessionRegistry.ensureTrackedSession(sessionId)) return;

    const pendingPermissions = this.permissions.clearBySessionId(sessionId);
    const accumulator =
      this.messageAccumulators.get(sessionId) ??
      accumulatorFromPendingPermissions(pendingPermissions);
    if (!accumulator) return;

    const partialReply = formatIMReply(sessionId, accumulator.messages);
    this.messageAccumulators.cleanup(sessionId);
    this.messageAccumulators.emitRunEvent(
      sessionId,
      accumulator,
      ActivityStatus.Failed,
      undefined,
      t('imSessionStoppedReply'),
    );
    accumulator.resolve?.(partialReply || t('imSessionStoppedReply'));
  }

  /**
   * Cleanup when handler is destroyed
   */
  destroy(): void {
    // Clear all pending accumulators
    this.messageAccumulators.destroyAll();
    this.sessionRegistry.clear();

    this.permissions.destroyAll();

    // Remove event listeners
    this.coworkRuntime.off('message', this.onMessage);
    this.coworkRuntime.off('messageUpdate', this.onMessageUpdate);
    this.coworkRuntime.off('permissionRequest', this.onPermissionRequest);
    this.coworkRuntime.off('complete', this.onComplete);
    this.coworkRuntime.off('error', this.onError);
    this.coworkRuntime.off('sessionStopped', this.onSessionStopped);
  }
}
