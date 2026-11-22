/**
 * Provider transport guards for the Pi native API registered through Magpie.
 *
 * Replaces the dropped @earendil-works/pi-ai patches inside the host runtime:
 * 1. Proportional context-window output clamping (prevents 4096-token fixed
 *    reserve starvation on small models and 1-token futile requests on overflow).
 * 2. Normalization of llama.cpp "Context size has been exceeded." HTTP/SSE
 *    errors (and rewriting 5xx overflow statuses to 400) so Pi's native
 *    isContextOverflow() recognizes them without wasting retries.
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  TranscriptContext,
  Usage,
} from '@earendil-works/pi-ai';
import type { ApiStreamFunction, ApiStreamSimpleFunction } from '@earendil-works/pi-ai/compat';
import {
  normalizeLlamaCppOverflowBody,
  normalizeLlamaCppOverflowMessage,
} from '../llamacppModelGateway';

const CONTEXT_SAFETY_TOKENS = 4096;
const CONTEXT_SAFETY_RATIO = 0.15;
const MIN_OUTPUT_WITH_RATIO_MARGIN = 32768;
const MIN_MAX_TOKENS = 1;
const CHARS_PER_TOKEN = 3.5;
const ESTIMATED_IMAGE_CHARS = 4800;

export type MagpieNativeApiSurface = {
  stream: ApiStreamFunction;
  streamSimple: ApiStreamSimpleFunction;
};

export function normalizeContextOverflowErrorMessage(message: string): string {
  return normalizeLlamaCppOverflowMessage(message);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return '[unserializable]';
  }
}

function calculateUsageTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function extractPlainText(
  content: string | ReadonlyArray<{ type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content;
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n');
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === 'string') {
    return Math.ceil(content.length / CHARS_PER_TOKEN);
  }
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content as ReadonlyArray<{ type?: unknown; text?: unknown }>) {
    chars +=
      block?.type === 'text' && typeof block.text === 'string'
        ? block.text.length
        : ESTIMATED_IMAGE_CHARS;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function estimateSingleMessageTokens(message: TranscriptContext['messages'][number]): number {
  const msg = message as unknown as Record<string, unknown>;
  if (msg.role === 'system') {
    const parts = [
      extractPlainText(msg.content as string | Array<{ type: string; text?: string }>),
    ];
    const sections = msg.sections as Record<string, string | null> | undefined;
    if (sections) {
      for (const value of Object.values(sections)) {
        if (value !== null) parts.push(value);
      }
    }
    const systemText = parts.filter(part => part.length > 0).join('\n\n');
    const toolsAdded =
      Array.isArray(msg.toolsAdded) && msg.toolsAdded.length > 0
        ? Math.ceil(safeJsonStringify(msg.toolsAdded).length / CHARS_PER_TOKEN)
        : 0;
    const toolsRemoved =
      Array.isArray(msg.toolsRemoved) && msg.toolsRemoved.length > 0
        ? Math.ceil(safeJsonStringify(msg.toolsRemoved).length / CHARS_PER_TOKEN)
        : 0;
    return Math.ceil(systemText.length / CHARS_PER_TOKEN) + toolsAdded + toolsRemoved;
  }
  if (msg.role === 'user' || msg.role === 'toolResult') {
    return estimateContentTokens(msg.content);
  }
  const content = Array.isArray(msg.content) ? msg.content : [];
  let chars = 0;
  for (const rawBlock of content) {
    if (!rawBlock || typeof rawBlock !== 'object') continue;
    const block = rawBlock as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (block.type === 'text' && typeof block.text === 'string') {
      chars += block.text.length;
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      chars += block.thinking.length;
    } else {
      chars += String(block.name ?? '').length + safeJsonStringify(block.arguments).length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// Local mirror of @earendil-works/pi-ai/utils/estimate keeps CJS compile:electron free of ESM-only imports.
function estimatePiContextTokens(context: TranscriptContext): number {
  const messages = context.messages;
  let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
  let usageInfo: { usage: Usage; index: number } | undefined;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i] as unknown as Partial<AssistantMessage> & { timestamp?: number };
    if (message.role === 'assistant') {
      const usageAppliesToPrefix = (message.timestamp ?? 0) >= latestPrefixTimestamp;
      if (
        usageAppliesToPrefix &&
        message.stopReason !== 'aborted' &&
        message.stopReason !== 'error' &&
        message.usage &&
        calculateUsageTokens(message.usage) > 0
      ) {
        usageInfo = { usage: message.usage, index: i };
      }
    }
    latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp ?? 0);
  }
  if (usageInfo) {
    let trailing = 0;
    for (let i = usageInfo.index + 1; i < messages.length; i++) {
      trailing += estimateSingleMessageTokens(messages[i]);
    }
    return calculateUsageTokens(usageInfo.usage) + trailing;
  }
  let total = 0;
  for (const message of messages) {
    total += estimateSingleMessageTokens(message);
  }
  return total;
}

function clampWithInputAndFixedMargin(
  contextWindow: number,
  input: number,
  fixedMargin: number,
  maxTokens: number,
): number {
  if (contextWindow <= 0) {
    return Math.max(MIN_MAX_TOKENS, maxTokens);
  }
  const margin = Math.max(fixedMargin, Math.ceil(input * CONTEXT_SAFETY_RATIO));
  let room = contextWindow - input - margin;
  if (room < MIN_OUTPUT_WITH_RATIO_MARGIN) {
    room = Math.min(MIN_OUTPUT_WITH_RATIO_MARGIN, contextWindow - input - fixedMargin);
  }
  return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, room));
}

function createLocalAssistantMessageEventStream(): AssistantMessageEventStream {
  const queue: AssistantMessageEvent[] = [];
  const waiters: Array<(result: IteratorResult<AssistantMessageEvent>) => void> = [];
  let done = false;
  let resolveFinalResult!: (message: AssistantMessage) => void;
  const finalResultPromise = new Promise<AssistantMessage>(resolve => {
    resolveFinalResult = resolve;
  });

  const stream = {
    push(event: AssistantMessageEvent) {
      if (done) return;
      if (event.type === 'done') {
        done = true;
        resolveFinalResult(event.message);
      } else if (event.type === 'error') {
        done = true;
        resolveFinalResult(event.error);
      }
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value: event, done: false });
      } else {
        queue.push(event);
      }
    },
    end(result?: AssistantMessage) {
      done = true;
      if (result !== undefined) {
        resolveFinalResult(result);
      }
      while (waiters.length > 0) {
        waiters.shift()!({ value: undefined, done: true });
      }
    },
    async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (done) {
          return;
        } else {
          const next = await new Promise<IteratorResult<AssistantMessageEvent>>(resolve =>
            waiters.push(resolve),
          );
          if (next.done) return;
          yield next.value;
        }
      }
    },
    result(): Promise<AssistantMessage> {
      return finalResultPromise;
    },
  };
  return stream as unknown as AssistantMessageEventStream;
}

/**
 * Proportional replacement for upstream `clampMaxTokensToContext`: scales the
 * fixed reserve margin on small context windows and throws an explicit overflow
 * error instead of emitting a 1-token request when no output budget remains.
 */
export function clampMagpieMaxTokensToContext(
  model: { contextWindow: number },
  context: TranscriptContext,
  maxTokens: number,
  precomputedInput?: number,
): number {
  if (model.contextWindow <= 0) {
    return Math.max(MIN_MAX_TOKENS, maxTokens);
  }
  const input = precomputedInput ?? estimatePiContextTokens(context);
  const fixedMargin = Math.min(
    CONTEXT_SAFETY_TOKENS,
    Math.ceil(model.contextWindow * CONTEXT_SAFETY_RATIO),
  );
  const margin = Math.max(fixedMargin, Math.ceil(input * CONTEXT_SAFETY_RATIO));
  let room = model.contextWindow - input - margin;
  if (room < MIN_OUTPUT_WITH_RATIO_MARGIN) {
    room = Math.min(MIN_OUTPUT_WITH_RATIO_MARGIN, model.contextWindow - input - fixedMargin);
  }
  if (room < MIN_MAX_TOKENS) {
    throw new Error(
      `Context window exceeded: estimated input ${input} leaves no output budget in ${model.contextWindow} tokens`,
    );
  }
  return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, room));
}

function buildErrorAssistantMessage(
  model: { api: AssistantMessage['api']; provider: string; id: string },
  errorMessage: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  };
}

function createImmediateOverflowErrorStream(
  model: { api: AssistantMessage['api']; provider: string; id: string },
  errorMessage: string,
  createEventStream: () => AssistantMessageEventStream,
) {
  const stream = createEventStream();
  const message = buildErrorAssistantMessage(model, errorMessage);
  stream.push({ type: 'error', reason: 'error', error: message });
  stream.end(message);
  return stream;
}

function wrapFetchWithOverflowNormalization(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.ok || response.status < 500) {
      return response;
    }
    const bodyText = await response.clone().text();
    const normalizedBody = normalizeLlamaCppOverflowBody(bodyText);
    if (normalizedBody === bodyText) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(normalizedBody, {
      status: 400,
      statusText: 'Bad Request',
      headers,
    });
  };
}

function normalizeErrorMessageOnAssistant(message: AssistantMessage | undefined): void {
  if (message?.errorMessage) {
    message.errorMessage = normalizeLlamaCppOverflowMessage(message.errorMessage);
  }
}

function wrapStreamWithOverflowNormalization(
  model: { api: AssistantMessage['api']; provider: string; id: string },
  source: ReturnType<ApiStreamFunction>,
  createEventStream: () => AssistantMessageEventStream,
) {
  const outer = createEventStream();
  void (async () => {
    let lastResult: AssistantMessage | undefined;
    try {
      for await (const event of source) {
        if (event.type === 'error') {
          normalizeErrorMessageOnAssistant(event.error);
          lastResult = event.error;
        } else if (event.type === 'done') {
          lastResult = event.message;
        }
        outer.push(event);
      }
      if (typeof source.result === 'function') {
        const result = await source.result();
        normalizeErrorMessageOnAssistant(result);
        lastResult = result;
      }
      outer.end(lastResult);
    } catch (error) {
      const messageText = normalizeLlamaCppOverflowMessage(
        error instanceof Error ? error.message : String(error),
      );
      const failure = buildErrorAssistantMessage(model, messageText);
      outer.push({ type: 'error', reason: 'error', error: failure });
      outer.end(failure);
    }
  })();
  return outer;
}

export function wrapMagpieNativeApi<TApi extends MagpieNativeApiSurface>(
  nativeApi: TApi,
  createEventStream: () => AssistantMessageEventStream = createLocalAssistantMessageEventStream,
): TApi {
  if (!nativeApi) return nativeApi;
  return {
    ...nativeApi,
    stream: (model, context, options) => {
      const guardedFetch = wrapFetchWithOverflowNormalization(options?.fetch);
      const nextOptions = options ? { ...options, fetch: guardedFetch } : { fetch: guardedFetch };
      return wrapStreamWithOverflowNormalization(
        model,
        nativeApi.stream(model, context, nextOptions),
        createEventStream,
      );
    },
    streamSimple: (model, context, options) => {
      const requestedMaxTokens = options?.maxTokens ?? model.maxTokens;
      const estimatedInput = model.contextWindow > 0 ? estimatePiContextTokens(context) : 0;
      let safeMaxTokens: number;
      try {
        safeMaxTokens = clampMagpieMaxTokensToContext(
          model,
          context,
          requestedMaxTokens,
          estimatedInput,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createImmediateOverflowErrorStream(model, message, createEventStream);
      }
      const upstreamClamped = clampWithInputAndFixedMargin(
        model.contextWindow,
        estimatedInput,
        CONTEXT_SAFETY_TOKENS,
        requestedMaxTokens,
      );
      const bypassUpstreamFixedReserve = model.contextWindow > 0 && upstreamClamped < safeMaxTokens;
      const upstreamModel = bypassUpstreamFixedReserve ? { ...model, contextWindow: 0 } : model;
      const guardedFetch = wrapFetchWithOverflowNormalization(options?.fetch);
      const upstreamOptions = {
        ...options,
        maxTokens: safeMaxTokens,
        fetch: guardedFetch,
      };
      return wrapStreamWithOverflowNormalization(
        model,
        nativeApi.streamSimple(upstreamModel, context, upstreamOptions),
        createEventStream,
      );
    },
  };
}
