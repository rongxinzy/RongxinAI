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
 * - ./imCoworkHandler/accumulator      – pending replies and run projection
 * - ./imCoworkHandler/permissions      – channel permission confirmation flow
 * - ./imCoworkHandler/turnLauncher     – Pi runtime start/continue dispatch
 * - ./imCoworkHandler/replies          – reply and media formatting helpers
 */

import { EventEmitter } from 'events';

import { type CoworkError } from '../../common/coworkError';
import { ActivityStatus } from '../../shared/activity/constants';
import type { ActivityService } from '../activity/activityService';
import type { CoworkStore } from '../coworkStore';
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
import { formatIMErrorReply, formatIMMessageWithMedia } from './imCoworkHandler/replies';
import { IMCoworkSessionRegistry } from './imCoworkHandler/sessionRegistry';
import { launchIMCoworkRuntimeTurn } from './imCoworkHandler/turnLauncher';
import { toPiAttachments } from './imPiAttachments';
import type { IMStore } from './imStore';
import type { IMMessage } from './types';

export interface IMCoworkHandlerOptions {
  coworkRuntime: PiRuntime;
  coworkStore: CoworkStore;
  imStore: IMStore;
  getSkillsPrompt?: () => Promise<string | null>;
  activityService?: Pick<ActivityService, 'recordChannelRun'>;
}

export class IMCoworkHandler extends EventEmitter {
  private coworkRuntime: PiRuntime;
  private coworkStore: CoworkStore;
  private imStore: IMStore;
  private getSkillsPrompt?: () => Promise<string | null>;
  private activityService?: Pick<ActivityService, 'recordChannelRun'>;

  private readonly sessionRegistry: IMCoworkSessionRegistry;
  private readonly messageAccumulators: IMCoworkAccumulatorRegistry;
  private readonly permissions: IMCoworkPermissionRegistry;

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
      getLiveStreamTexts: sessionId => this.coworkRuntime.getLiveStreamTexts(sessionId),
      stopSession: sessionId => this.coworkRuntime.stopSession(sessionId),
    });

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for Pi runtime events.
   */
  private setupEventListeners(): void {
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
      const formattedContent = formatIMMessageWithMedia(message);
      const piAttachments = await toPiAttachments(message.attachments);

      const responsePromise = this.messageAccumulators.createResponsePromise(coworkSessionId, cid);
      const cancelTurn = () => {
        const accumulator = this.messageAccumulators.get(coworkSessionId);
        if (!accumulator || accumulator.runId !== cid) return;
        this.messageAccumulators.cleanup(coworkSessionId);
        this.coworkRuntime.stopSession(coworkSessionId);
        this.messageAccumulators.emitRunEvent(
          coworkSessionId,
          accumulator.runId,
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

      this.activityService?.recordChannelRun({
        id: cid,
        status: ActivityStatus.Running,
        sessionId: coworkSessionId,
        platform: message.platform,
        conversationId: message.conversationId,
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

  private async handlePendingPermissionReply(message: IMMessage): Promise<string | null> {
    const key = createIMConversationKey(message.conversationId, message.platform);
    const pending = this.permissions.get(key);
    if (!pending) return null;

    const normalizedReply = message.content.trim().replace(/[。！!,.，\s]+$/g, '');
    if (!normalizedReply) {
      return '当前有待确认操作，请回复“允许”或“拒绝”（60 秒内）。';
    }

    const conversation = this.sessionRegistry.getConversation(pending.sessionId);
    if (
      !this.coworkRuntime.isSessionActive(pending.sessionId) ||
      conversation?.platform !== message.platform ||
      conversation.conversationId !== message.conversationId
    ) {
      this.permissions.clearByKey(key);
      this.messageAccumulators.emitRunEvent(
        pending.sessionId,
        pending.runId,
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
        pending.runId,
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
    const conversation = this.sessionRegistry.getConversation(sessionId);
    if (!conversation) return;
    const key = createIMConversationKey(conversation.conversationId, conversation.platform);
    const accumulator = this.messageAccumulators.get(sessionId);
    const pending = this.permissions.get(key);
    const runId = accumulator?.runId ?? (pending?.sessionId === sessionId ? pending.runId : null);
    if (!runId) return;
    const existingPending = this.permissions.clearByKey(key);
    if (existingPending) {
      this.coworkRuntime.respondToPermission(existingPending.request.requestId, {
        behavior: 'deny',
        message: 'Superseded by a newer permission request.',
      });
    }

    this.permissions.track(
      {
        key,
        runId,
        sessionId,
        request,
        conversationId: conversation.conversationId,
        platform: conversation.platform,
      },
      currentPending => {
        this.coworkRuntime.respondToPermission(request.requestId, {
          behavior: 'deny',
          message: 'Permission request timed out after 60s',
        });
        this.messageAccumulators.emitRunEvent(
          currentPending.sessionId,
          currentPending.runId,
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
    const pendingPermissions = this.permissions.clearBySessionId(sessionId);
    const accumulator =
      this.messageAccumulators.get(sessionId) ??
      accumulatorFromPendingPermissions(pendingPermissions);
    if (!accumulator) {
      return;
    }

    const replyText = this.messageAccumulators.formatReply(sessionId, accumulator);
    if (replyText === null) return;

    this.messageAccumulators.cleanup(sessionId);

    this.messageAccumulators.emitRunEvent(
      sessionId,
      accumulator.runId,
      ActivityStatus.Completed,
      replyText,
    );

    accumulator.resolve?.(replyText);
  }

  /**
   * Handle session error event
   */
  private handleError(sessionId: string, error: CoworkError): void {
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
      accumulator.runId,
      ActivityStatus.Failed,
      undefined,
      replyText,
    );

    accumulator.reject?.(new Error(replyText));
  }

  private handleSessionStopped(sessionId: string): void {
    const pendingPermissions = this.permissions.clearBySessionId(sessionId);
    const accumulator =
      this.messageAccumulators.get(sessionId) ??
      accumulatorFromPendingPermissions(pendingPermissions);
    if (!accumulator) return;

    const partialReply = this.messageAccumulators.formatReply(sessionId, accumulator, true);
    if (partialReply === null) return;
    this.messageAccumulators.cleanup(sessionId);
    this.messageAccumulators.emitRunEvent(
      sessionId,
      accumulator.runId,
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

    this.permissions.destroyAll();

    // Remove event listeners
    this.coworkRuntime.off('permissionRequest', this.onPermissionRequest);
    this.coworkRuntime.off('complete', this.onComplete);
    this.coworkRuntime.off('error', this.onError);
    this.coworkRuntime.off('sessionStopped', this.onSessionStopped);
  }
}
