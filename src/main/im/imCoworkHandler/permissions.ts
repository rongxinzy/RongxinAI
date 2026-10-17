/**
 * IM permission confirmation flow: pending-permission bookkeeping with
 * timeouts, plus prompt/result construction for channel-delivered approvals.
 */

import type { Platform } from '../../../shared/platform';
import type { PermissionRequest, PermissionResult } from '../../libs/agentEngine/types';
import type { IMCoworkBackgroundDelivery, MessageAccumulator, PendingIMPermission } from './types';

const PERMISSION_CONFIRM_TIMEOUT_MS = 60_000;
const IM_ALLOW_RESPONSE_RE = /^(允许|同意|yes|y)$/i;
const IM_DENY_RESPONSE_RE = /^(拒绝|不同意|no|n)$/i;
const IM_ALLOW_OPTION_LABEL = '允许本次操作';

export function createIMConversationKey(conversationId: string, platform: Platform): string {
  return `${platform}:${conversationId}`;
}

export function isIMAllowResponse(reply: string): boolean {
  return IM_ALLOW_RESPONSE_RE.test(reply);
}

export function isIMDenyResponse(reply: string): boolean {
  return IM_DENY_RESPONSE_RE.test(reply);
}

export function buildIMPermissionPrompt(request: PermissionRequest): string {
  const questions = Array.isArray(request.toolInput?.questions)
    ? (request.toolInput.questions as Array<Record<string, unknown>>)
    : [];
  const firstQuestion = questions[0];
  const questionText = typeof firstQuestion?.question === 'string' ? firstQuestion.question : '';

  return [
    `检测到需要安全确认的操作（工具: ${request.toolName}）。`,
    questionText ? `说明: ${questionText}` : '说明: 当前操作涉及删除或访问任务目录外路径。',
    '请在 60 秒内回复“允许”或“拒绝”。',
  ].join('\n');
}

export function buildIMAllowPermissionResult(request: PermissionRequest): PermissionResult {
  if (request.toolName !== 'AskUserQuestion') {
    return {
      behavior: 'allow',
      updatedInput: request.toolInput,
    };
  }

  const input =
    request.toolInput && typeof request.toolInput === 'object'
      ? { ...(request.toolInput as Record<string, unknown>) }
      : {};
  const rawQuestions = Array.isArray(input.questions)
    ? (input.questions as Array<Record<string, unknown>>)
    : [];

  const answers: Record<string, string> = {};
  rawQuestions.forEach(question => {
    const questionTitle = typeof question?.question === 'string' ? question.question : '';
    if (!questionTitle) return;
    const options = Array.isArray(question?.options)
      ? (question.options as Array<Record<string, unknown>>)
      : [];
    const preferredOption = options.find(option => {
      const label = typeof option?.label === 'string' ? option.label : '';
      return label.includes(IM_ALLOW_OPTION_LABEL);
    });
    const fallbackOption = options[0];
    const selectedLabel =
      typeof preferredOption?.label === 'string'
        ? preferredOption.label
        : typeof fallbackOption?.label === 'string'
          ? fallbackOption.label
          : IM_ALLOW_OPTION_LABEL;
    answers[questionTitle] = selectedLabel;
  });

  return {
    behavior: 'allow',
    updatedInput: {
      ...input,
      answers,
    },
  };
}

export function accumulatorFromPendingPermissions(
  pendingPermissions: PendingIMPermission[],
): MessageAccumulator | undefined {
  const pending = pendingPermissions[0];
  if (!pending) return undefined;

  return {
    runId: pending.runId,
    messages: [],
    backgroundDelivery: pending.backgroundDelivery,
  };
}

interface IMCoworkPendingPermissionEntry {
  key: string;
  runId: string;
  sessionId: string;
  request: PermissionRequest;
  conversationId: string;
  platform: Platform;
  backgroundDelivery?: IMCoworkBackgroundDelivery;
}

export class IMCoworkPermissionRegistry {
  private readonly pendingByConversation = new Map<string, PendingIMPermission>();

  get(key: string): PendingIMPermission | undefined {
    return this.pendingByConversation.get(key);
  }

  /**
   * Register a pending permission for a conversation. The 60s confirmation
   * timeout is armed here; `onTimeout` runs only when this exact request is
   * still pending when the timer fires.
   */
  track(
    entry: IMCoworkPendingPermissionEntry,
    onTimeout: (pending: PendingIMPermission) => void,
  ): void {
    const timeoutId = setTimeout(() => {
      const currentPending = this.pendingByConversation.get(entry.key);
      if (!currentPending || currentPending.request.requestId !== entry.request.requestId) {
        return;
      }
      this.clearByKey(entry.key);
      onTimeout(currentPending);
    }, PERMISSION_CONFIRM_TIMEOUT_MS);

    this.pendingByConversation.set(entry.key, {
      ...entry,
      createdAt: Date.now(),
      timeoutId,
    });
  }

  clearByKey(key: string): PendingIMPermission | null {
    const pending = this.pendingByConversation.get(key);
    if (!pending) return null;

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingByConversation.delete(key);
    return pending;
  }

  clearBySessionId(sessionId: string): PendingIMPermission[] {
    const keysToRemove: string[] = [];
    this.pendingByConversation.forEach((pending, key) => {
      if (pending.sessionId === sessionId) {
        keysToRemove.push(key);
      }
    });
    return keysToRemove
      .map(key => this.clearByKey(key))
      .filter((pending): pending is PendingIMPermission => pending !== null);
  }

  /** Clear every pending permission timer (handler teardown). */
  destroyAll(): void {
    this.pendingByConversation.forEach(pending => {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
    });
    this.pendingByConversation.clear();
  }
}
