import type { LlamaCppChatChunk as OllamaChatChunk } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import {
  DIRECT_ANSWER_SYSTEM_HINT,
  LOCAL_INFERENCE_MAX_SPEED_FOR_SMALL_COMPLETION,
  LOCAL_INFERENCE_MAX_SPEED_FOR_TINY_COMPLETION,
  LOCAL_INFERENCE_MIN_SPEED_SAMPLE_SECONDS,
} from '../constants';
import type {
  BuildAssistantMessageInput,
  InferenceMessage,
  LocalInferenceInlineError,
} from '../types';

export function resolveLocalInferenceInlineError(error: unknown): LocalInferenceInlineError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!isContextOverflowErrorMessage(message)) {
    return null;
  }
  const match = message.match(
    /request\s*\((\d+)\s*tokens\)\s*exceeds the available context size\s*\((\d+)\s*tokens\)/i,
  );
  return {
    kind: 'context-overflow',
    requestedTokens: match ? Number.parseInt(match[1], 10) : null,
    availableTokens: match ? Number.parseInt(match[2], 10) : null,
  };
}

export function isContextOverflowErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('exceed_context_size_error') ||
    normalized.includes('ran out of context size') ||
    (normalized.includes('available context size') && normalized.includes('exceeds'))
  );
}

function readNestedNumber(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function computeStreamMetrics(
  finalChunk: OllamaChatChunk | null,
  streamStartTime: number,
  accumulatedContent: string,
): OllamaChatChunk | null {
  if (!finalChunk) return null;
  const evalCount = finalChunk.eval_count;
  const completionTokens = readNestedNumber(finalChunk.usage, 'completion_tokens')
    ?? readNestedNumber(finalChunk.timings, 'predicted_n')
    ?? evalCount;
  const rawElapsed = readNestedNumber(finalChunk.timings, 'predicted_ms') != null
    ? readNestedNumber(finalChunk.timings, 'predicted_ms')! / 1000
    : (Date.now() - streamStartTime) / 1000;
  const elapsed = Math.max(LOCAL_INFERENCE_MIN_SPEED_SAMPLE_SECONDS, rawElapsed);
  const estimatedSpeed = completionTokens != null ? completionTokens / elapsed : null;

  const reportedSpeed =
    finalChunk.predicted_per_second ?? readNestedNumber(finalChunk.timings, 'predicted_per_second');
  const sanitizedReportedSpeed = sanitizePredictedPerSecond({
    reportedSpeed,
    completionTokens,
    estimatedSpeed,
  });
  if (sanitizedReportedSpeed != null) {
    return { ...finalChunk, predicted_per_second: sanitizedReportedSpeed };
  }

  if (evalCount != null) return { ...finalChunk, predicted_per_second: evalCount / elapsed };

  const rawLen =
    accumulatedContent.length > 0 ? accumulatedContent.length : (finalChunk.message?.content?.length ?? 0);
  if (rawLen > 0) return { ...finalChunk, predicted_per_second: Math.round(rawLen / 3) / elapsed };
  return finalChunk;
}

function sanitizePredictedPerSecond(input: {
  reportedSpeed: number | null | undefined;
  completionTokens: number | null | undefined;
  estimatedSpeed: number | null;
}): number | null {
  const { reportedSpeed, completionTokens, estimatedSpeed } = input;
  if (reportedSpeed == null || !Number.isFinite(reportedSpeed) || reportedSpeed <= 0) {
    return estimatedSpeed;
  }
  if (completionTokens != null && completionTokens <= 2) {
    return reportedSpeed > LOCAL_INFERENCE_MAX_SPEED_FOR_TINY_COMPLETION
      ? estimatedSpeed
      : reportedSpeed;
  }
  if (completionTokens != null && completionTokens <= 8) {
    return reportedSpeed > LOCAL_INFERENCE_MAX_SPEED_FOR_SMALL_COMPLETION
      ? estimatedSpeed
      : reportedSpeed;
  }
  return reportedSpeed;
}

export function formatMetricsSummary(metrics: OllamaChatChunk): string {
  const speedValue = metrics.predicted_per_second;
  const speed = speedValue != null ? speedValue.toFixed(1) : '-';
  const completionTokens = readNestedNumber(metrics.usage, 'completion_tokens')
    ?? readNestedNumber(metrics.timings, 'predicted_n')
    ?? metrics.eval_count;
  const speedLabel = i18nService.t('localInferenceMetricsSpeed').replace('{speed}', speed);
  return completionTokens != null
    ? `${speedLabel} (${Math.round(completionTokens)} tokens)`
    : speedLabel;
}

function estimateReasoningDurationSeconds(metrics: OllamaChatChunk): number | undefined {
  const predictedMs = readNestedNumber(metrics.timings, 'predicted_ms');
  if (predictedMs == null) return undefined;
  return Math.max(1, Math.round(predictedMs / 1000));
}

export function formatThoughtDuration(durationSeconds?: number): string {
  if (!durationSeconds || durationSeconds <= 0) {
    return i18nService.t('localInferenceThinking');
  }
  return i18nService
    .t('localInferenceThoughtForSeconds')
    .replace('{seconds}', String(durationSeconds));
}

export function formatMessageTimestamp(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(createdAt);
}

export function buildAssistantMessage({
  content,
  thinking,
  metrics,
}: BuildAssistantMessageInput): InferenceMessage {
  const visibleContent = content.trim()
    ? content
    : thinking.trim()
      ? i18nService.t('localInferenceNoVisibleReply')
      : content;
  return {
    role: 'assistant',
    content: visibleContent,
    ...(thinking.trim() ? { thinking } : {}),
    metrics,
    createdAt: Date.now(),
    ...(thinking.trim() && metrics
      ? { reasoningDurationSeconds: estimateReasoningDurationSeconds(metrics) }
      : {}),
  };
}

export function buildStreamingAssistantMessage(input: {
  content: string;
  thinking: string;
}): InferenceMessage {
  const hasContent = Boolean(input.content.trim());
  const hasThinking = Boolean(input.thinking.trim());
  return {
    role: 'assistant',
    content: input.content,
    ...(hasThinking ? { thinking: input.thinking } : {}),
    waiting: !hasContent && !hasThinking,
    createdAt: Date.now(),
  };
}

export function findLatestUserMessageIndex(messages: InferenceMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

export function buildEffectiveSystemPrompt(systemPrompt: string): string {
  void DIRECT_ANSWER_SYSTEM_HINT;
  const trimmed = systemPrompt.trim();
  return trimmed;
}

