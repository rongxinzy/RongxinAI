/**
 * Reply formatting helpers for IM cowork turns: scheduled-task receipts,
 * raw reminder extraction, error replies, and media-formatted message content.
 */

import { type CoworkError, CoworkErrorKind } from '../../../common/coworkError';
import type { CoworkMessage } from '../../coworkStore';
import { t } from '../../i18n';
import { readIMScheduledTaskReceipts } from '../imScheduledTaskReceipts';
import type { IMMediaAttachment, IMMessage } from '../types';

export const DEFAULT_IM_EMPTY_REPLY = '处理完成，但没有生成回复。';

/**
 * Extract assistant text for the channel. Scheduled delivery already has its
 * own execution outcome, so it does not include task-creation receipts.
 */
export function formatIMReplyRaw(messages: CoworkMessage[]): string {
  return readAssistantText(messages) || DEFAULT_IM_EMPTY_REPLY;
}

function readAssistantText(messages: CoworkMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.type === 'assistant' && message.content && !message.metadata?.isThinking) {
      const text = message.content.trim();
      if (text) parts.push(text);
    }
  }
  return parts.join('\n\n');
}

/** Preserve the assistant's text and report explicitly observed tool failures. */
export function formatIMReply(messages: CoworkMessage[]): string {
  const assistantText = readAssistantText(messages);
  const { created, failed } = readIMScheduledTaskReceipts(messages);
  const reply = assistantText || (created ? t('imScheduledTaskCreated') : '');
  if (failed) return [reply, t('imScheduledTaskCreationFailed')].filter(Boolean).join('\n\n');
  return reply || DEFAULT_IM_EMPTY_REPLY;
}

/**
 * Generate a user-friendly IM reply text based on the error kind.
 * Different error categories get different guidance so IM users
 * know whether to wait, retry, or take action.
 */
export function formatIMErrorReply(error: CoworkError): string {
  switch (error.kind) {
    case CoworkErrorKind.AuthExpired:
      return t('imErrorAuthExpired');
    case CoworkErrorKind.RateLimited:
      return t('imErrorRateLimited');
    case CoworkErrorKind.BudgetExceeded:
      return t('imErrorBudgetExceeded');
    case CoworkErrorKind.EngineNotReady:
      return t('imErrorEngineNotReady');
    case CoworkErrorKind.GatewayStartFailed:
      return t('imErrorGatewayStartFailed');
    case CoworkErrorKind.NetworkError:
    case CoworkErrorKind.ServerError:
    case CoworkErrorKind.GatewayDisconnected:
    case CoworkErrorKind.ServiceRestart:
      return t('imErrorTransient', { error: error.message });
    case CoworkErrorKind.ContentFiltered:
      return t('imErrorContentFiltered');
    case CoworkErrorKind.InputTooLong:
      return t('imErrorInputTooLong');
    case CoworkErrorKind.ToolTimeout:
    case CoworkErrorKind.MaxIterations:
      return t('imErrorExecutionLimit');
    case CoworkErrorKind.ModelCapabilityUnsupported:
      return t('imErrorModelCapabilityUnsupported');
    case CoworkErrorKind.ProviderUnavailable:
      return t('imErrorProviderUnavailable');
    case CoworkErrorKind.StreamInterrupted:
      return t('imErrorStreamInterrupted');
    default:
      return t('imErrorUnknown', { error: error.message });
  }
}

/**
 * Format message content with media attachment information
 * Appends media metadata to content so AI can access the files
 */
export function formatIMMessageWithMedia(message: IMMessage): string {
  let content = message.content;

  if (message.attachments && message.attachments.length > 0) {
    const mediaInfo = message.attachments
      .map((att: IMMediaAttachment) => {
        const parts = [`类型: ${att.type}`, `路径: ${att.localPath}`];
        if (att.fileName) parts.push(`文件名: ${att.fileName}`);
        if (att.mimeType) parts.push(`MIME: ${att.mimeType}`);
        if (att.width && att.height) parts.push(`尺寸: ${att.width}x${att.height}`);
        if (att.duration) parts.push(`时长: ${att.duration}秒`);
        if (att.fileSize) parts.push(`大小: ${(att.fileSize / 1024).toFixed(1)}KB`);
        return `- ${parts.join(', ')}`;
      })
      .join('\n');

    content = content ? `${content}\n\n[附件信息]\n${mediaInfo}` : `[附件信息]\n${mediaInfo}`;
  }

  return content;
}
