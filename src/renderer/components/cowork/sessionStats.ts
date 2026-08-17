import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';

export interface SessionStats {
  turns: number;
  steps: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cacheHitPercent: number | null;
  llmDurationMs: number | null;
  toolDurationMs: number | null;
  ttftAverageMs: number | null;
  throughputTokensPerSecond: number | null;
}

interface MessageMetrics {
  requestStartedAt?: unknown;
  firstVisibleTextAt?: unknown;
  completedAt?: unknown;
  toolDurationMs?: unknown;
}

interface Sum {
  value: number;
  samples: number;
}

const EMPTY_SUM: Sum = { value: 0, samples: 0 };

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function getMetrics(metadata: CoworkMessageMetadata | undefined): MessageMetrics | null {
  const metrics = metadata?.metrics;
  return typeof metrics === 'object' && metrics !== null ? (metrics as MessageMetrics) : null;
}

function add(sum: Sum, value: unknown): Sum {
  if (!isFiniteNonNegative(value)) {
    return sum;
  }

  const nextValue = sum.value + value;
  return Number.isFinite(nextValue)
    ? { value: nextValue, samples: sum.samples + 1 }
    : sum;
}

function valueOrNull(sum: Sum): number | null {
  return sum.samples > 0 ? sum.value : null;
}

function getOrderedRange(start: unknown, end: unknown): [number, number] | null {
  if (!isFiniteNonNegative(start) || !isFiniteNonNegative(end) || end < start) {
    return null;
  }

  return [start, end];
}

export function getSessionStats(messages: CoworkMessage[]): SessionStats {
  let turns = 0;
  let steps = 0;
  let inputTokens = EMPTY_SUM;
  let outputTokens = EMPTY_SUM;
  let cacheReadTokens = EMPTY_SUM;
  let cacheWriteTokens = EMPTY_SUM;
  let llmDurationMs = EMPTY_SUM;
  let toolDurationMs = EMPTY_SUM;
  let ttftDurationMs = EMPTY_SUM;
  let decodedOutputTokens = EMPTY_SUM;
  let decodeDurationMs = EMPTY_SUM;
  let hasIncompleteBilledInput = false;

  for (const message of messages) {
    if (message.type === 'user') {
      turns += 1;
      continue;
    }

    const metrics = getMetrics(message.metadata);
    if (message.type === 'tool_result') {
      toolDurationMs = add(toolDurationMs, metrics?.toolDurationMs);
      if (isFiniteNonNegative(metrics?.toolDurationMs)) steps += 1;
      continue;
    }

    if (message.type !== 'assistant') {
      continue;
    }

    const usage = message.metadata?.usage;
    if (usage !== undefined && (
      !isFiniteNonNegative(usage.inputTokens) ||
      !isFiniteNonNegative(usage.cacheReadTokens) ||
      !isFiniteNonNegative(usage.cacheWriteTokens)
    )) {
      hasIncompleteBilledInput = true;
    }
    inputTokens = add(inputTokens, usage?.inputTokens);
    outputTokens = add(outputTokens, usage?.outputTokens);
    cacheReadTokens = add(cacheReadTokens, usage?.cacheReadTokens);
    cacheWriteTokens = add(cacheWriteTokens, usage?.cacheWriteTokens);

    const requestRange = getOrderedRange(metrics?.requestStartedAt, metrics?.completedAt);
    if (requestRange === null) {
      continue;
    }

    steps += 1;
    llmDurationMs = add(llmDurationMs, requestRange[1] - requestRange[0]);

    const ttftRange = getOrderedRange(metrics?.requestStartedAt, metrics?.firstVisibleTextAt);
    const decodeRange = getOrderedRange(metrics?.firstVisibleTextAt, metrics?.completedAt);
    if (ttftRange === null || decodeRange === null) {
      continue;
    }

    ttftDurationMs = add(ttftDurationMs, ttftRange[1] - ttftRange[0]);
    if (isFiniteNonNegative(usage?.outputTokens) && decodeRange[1] > decodeRange[0]) {
      decodedOutputTokens = add(decodedOutputTokens, usage.outputTokens);
      decodeDurationMs = add(decodeDurationMs, decodeRange[1] - decodeRange[0]);
    }
  }

  const input = valueOrNull(inputTokens);
  const cacheRead = valueOrNull(cacheReadTokens);
  const cacheWrite = valueOrNull(cacheWriteTokens);
  const hasVerifiedBilledInput = !hasIncompleteBilledInput
    && input !== null && cacheRead !== null && cacheWrite !== null;
  const billedInput = hasVerifiedBilledInput ? input + cacheRead + cacheWrite : null;
  const decodedTokens = valueOrNull(decodedOutputTokens);
  const decodeDuration = valueOrNull(decodeDurationMs);
  const cacheHitPercent =
    hasVerifiedBilledInput && billedInput !== null && billedInput > 0 && cacheRead !== null
      ? (cacheRead / billedInput) * 100
      : null;

  return {
    turns,
    steps,
    inputTokens: input,
    outputTokens: valueOrNull(outputTokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheHitPercent,
    llmDurationMs: valueOrNull(llmDurationMs),
    toolDurationMs: valueOrNull(toolDurationMs),
    ttftAverageMs:
      ttftDurationMs.samples > 0 ? ttftDurationMs.value / ttftDurationMs.samples : null,
    throughputTokensPerSecond:
      decodedTokens !== null && decodeDuration !== null && decodeDuration > 0
        ? decodedTokens / (decodeDuration / 1_000)
        : null,
  };
}

export function formatCompactTokenCount(value: number | null): string | null {
  if (!isFiniteNonNegative(value)) {
    return null;
  }

  if (value < 1_000) {
    return String(Math.round(value));
  }

  const divisor = value >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = divisor === 1_000_000 ? 'M' : 'K';
  return `${Number((value / divisor).toFixed(1))}${suffix}`;
}

export function formatDuration(value: number | null): string | null {
  if (!isFiniteNonNegative(value)) {
    return null;
  }

  if (value < 1_000) {
    return `${Math.round(value)}ms`;
  }

  const totalSeconds = Math.round(value / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatTokenRate(value: number | null): string | null {
  if (!isFiniteNonNegative(value)) {
    return null;
  }

  return `${Number(value.toFixed(1))} tok/s`;
}
