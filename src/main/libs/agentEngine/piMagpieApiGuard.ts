/**
 * Provider transport guards for the Pi native API registered through Magpie.
 *
 * Replaces the dropped @earendil-works/pi-ai patches inside RongxinAI:
 * 1. Proportional context-window output clamping (prevents 4096-token fixed
 *    reserve starvation on small models and 1-token futile requests on overflow).
 * 2. Normalization of llama.cpp "Context size has been exceeded." HTTP/SSE
 *    errors (and rewriting 5xx overflow statuses to 400) so Pi's native
 *    isContextOverflow() recognizes them without wasting retries.
 */

import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { clampMaxTokensToContext as upstreamClampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import type { ApiStreamFunction, ApiStreamSimpleFunction } from '@earendil-works/pi-ai/compat';
import {
  normalizeLlamaCppOverflowBody,
  normalizeLlamaCppOverflowMessage,
} from '../llamacppModelGateway';

const CONTEXT_SAFETY_TOKENS = 4096;
const CONTEXT_SAFETY_RATIO = 0.15;
const MIN_OUTPUT_WITH_RATIO_MARGIN = 32768;
const MIN_MAX_TOKENS = 1;

export type MagpieNativeApiSurface = {
  stream: ApiStreamFunction;
  streamSimple: ApiStreamSimpleFunction;
};

export function normalizeContextOverflowErrorMessage(message: string): string {
  return normalizeLlamaCppOverflowMessage(message);
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
): number {
  if (model.contextWindow <= 0) {
    return Math.max(MIN_MAX_TOKENS, maxTokens);
  }
  const input = estimateContextTokens(context).tokens;
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

function createImmediateOverflowErrorStream(
  model: { api: AssistantMessage['api']; provider: string; id: string },
  errorMessage: string,
) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
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
) {
  const outer = createAssistantMessageEventStream();
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
      const failure: AssistantMessage = {
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
        errorMessage: messageText,
        timestamp: Date.now(),
      };
      outer.push({ type: 'error', reason: 'error', error: failure });
      outer.end(failure);
    }
  })();
  return outer;
}

export function wrapMagpieNativeApi<TApi extends MagpieNativeApiSurface>(nativeApi: TApi): TApi {
  if (!nativeApi) return nativeApi;
  return {
    ...nativeApi,
    stream: (model, context, options) => {
      const guardedFetch = wrapFetchWithOverflowNormalization(options?.fetch);
      const nextOptions = options ? { ...options, fetch: guardedFetch } : { fetch: guardedFetch };
      return wrapStreamWithOverflowNormalization(
        model,
        nativeApi.stream(model, context, nextOptions),
      );
    },
    streamSimple: (model, context, options) => {
      const requestedMaxTokens = options?.maxTokens ?? model.maxTokens;
      let safeMaxTokens: number;
      try {
        safeMaxTokens = clampMagpieMaxTokensToContext(model, context, requestedMaxTokens);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createImmediateOverflowErrorStream(model, message);
      }
      const upstreamClamped = upstreamClampMaxTokensToContext(model, context, requestedMaxTokens);
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
      );
    },
  };
}
