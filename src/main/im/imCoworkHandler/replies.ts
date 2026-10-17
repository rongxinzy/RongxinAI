/**
 * Reply formatting helpers for IM cowork turns: guard-checked replies,
 * raw reminder extraction, error replies, and media-formatted message content.
 */

import { type CoworkError, CoworkErrorKind } from '../../../common/coworkError';
import type { CoworkMessage } from '../../coworkStore';
import { t } from '../../i18n';
import { analyzeIMReply, DEFAULT_IM_EMPTY_REPLY } from '../imReplyGuard';
import type { IMMediaAttachment, IMMessage } from '../types';

/**
 * Extract raw assistant text from accumulated messages, bypassing the
 * reminder-commitment guard.  Used for cron-triggered background deliveries
 * where the reply IS the scheduled reminder, not a promise to create one.
 */
export function formatIMReplyRaw(messages: CoworkMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.type === 'assistant' && message.content && !message.metadata?.isThinking) {
      const text = message.content.trim();
      if (text) parts.push(text);
    }
  }
  return parts.join('\n\n') || DEFAULT_IM_EMPTY_REPLY;
}

/**
 * Format accumulated messages into a reply string
 */
export function formatIMReply(sessionId: string, messages: CoworkMessage[]): string {
  const analysis = analyzeIMReply(messages);

  if (analysis.guardApplied) {
    console.warn(
      '[IMCoworkHandler] Guarded misleading reminder reply without successful cron.add',
      JSON.stringify({
        sessionId,
        attemptedCronAdds: analysis.attemptedCronAdds,
        successfulCronAdds: analysis.successfulCronAdds,
        lastCronAddError: analysis.lastCronAddError,
        assistantText: analysis.assistantText,
      }),
    );
  }

  return analysis.text;
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
