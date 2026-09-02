import {
  type ChatRequestOptions,
  type ChatTransport,
  generateId,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';

import {
  buildOpenAICompatibleChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  detectProvider,
  getProviderConfig,
  normalizeApiFormat,
  providerRequiresApiKey,
  shouldUseOpenAIResponsesApi,
} from './apiConfigResolver';
import { buildAnthropicMessagesUrl } from '../../shared/providers';

export interface IpcChatTransportOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  apiFormat?: 'anthropic' | 'openai' | 'gemini';
  systemPrompt?: string;
}

function extractTextFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('');
}

function formatOpenAIMessage(message: UIMessage): Record<string, unknown> | null {
  const content = extractTextFromUIMessage(message);
  if (!content?.trim()) return null;
  return { role: message.role, content };
}

function formatOpenAIResponsesInputMessage(message: UIMessage): Record<string, unknown> | null {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const content = extractTextFromUIMessage(message);
  if (!content?.trim()) return null;
  if (role === 'assistant') {
    return { role, content: [{ type: 'output_text', text: content }] };
  }
  return { role, content: [{ type: 'input_text', text: content }] };
}

function formatAnthropicMessage(message: UIMessage): Record<string, unknown> | null {
  if (message.role === 'system') return null;
  const content = extractTextFromUIMessage(message);
  if (!content?.trim()) return null;
  return { role: message.role, content };
}

function detectModel(messages: UIMessage[]): string {
  if (typeof window !== 'undefined') {
    const modelState = (window as unknown as Record<string, unknown>).__MODEL_STATE__;
    if (modelState && typeof modelState === 'object' && 'defaultSelectedModel' in modelState) {
      const selected = (modelState as { defaultSelectedModel?: { id?: string } })
        .defaultSelectedModel;
      if (selected?.id) return selected.id;
    }
  }
  return messages[messages.length - 1]?.id ?? 'unknown';
}

/**
 * A `ChatTransport` that routes AI SDK v6 chat requests through the existing
 * Electron `api:stream` IPC channel. Supports text, tool calls, reasoning, and
 * errors for OpenAI-compatible, Anthropic, and Gemini providers.
 */
export class IpcChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly options: IpcChatTransportOptions = {}) {}

  async sendMessages({
    chatId,
    messages,
    abortSignal,
  }: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    const modelId = this.options.model || detectModel(messages);
    const provider = this.options.provider || detectProvider(modelId);
    const config = this.options.apiKey
      ? {
          apiKey: this.options.apiKey,
          baseUrl: this.options.baseUrl || '',
          provider,
          apiFormat: normalizeApiFormat(this.options.apiFormat),
        }
      : getProviderConfig(provider);

    if (!config) {
      throw new Error(`Provider ${provider} is not configured or enabled.`);
    }

    if (providerRequiresApiKey(provider) && !config.apiKey) {
      throw new Error(`API key is required for provider ${provider}.`);
    }

    const apiFormat = this.options.apiFormat
      ? normalizeApiFormat(this.options.apiFormat)
      : config.apiFormat;

    const { url, headers, body } = this.buildRequest(
      messages,
      provider,
      config.apiKey,
      config.baseUrl,
      modelId,
      apiFormat,
    );
    return this.streamOverIpc(chatId, url, headers, body, abortSignal, apiFormat);
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }

  private buildRequest(
    messages: UIMessage[],
    provider: string,
    apiKey: string,
    baseUrl: string,
    modelId: string,
    apiFormat: 'anthropic' | 'openai' | 'gemini',
  ): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    if (apiFormat === 'gemini') {
      return this.buildGeminiRequest(messages, apiKey, baseUrl, modelId);
    }
    if (apiFormat === 'anthropic') {
      return this.buildAnthropicRequest(messages, apiKey, baseUrl, modelId);
    }
    return this.buildOpenAICompatibleRequest(messages, apiKey, baseUrl, modelId, provider);
  }

  private buildOpenAICompatibleRequest(
    messages: UIMessage[],
    apiKey: string,
    baseUrl: string,
    modelId: string,
    provider: string,
  ): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    const useResponsesApi = shouldUseOpenAIResponsesApi(provider);
    const url = useResponsesApi
      ? buildOpenAIResponsesUrl(baseUrl)
      : buildOpenAICompatibleChatCompletionsUrl(baseUrl);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const nonSystem = messages.filter(m => m.role !== 'system');
    const systemMessages = messages.filter(m => m.role === 'system');
    const allSystem = [this.options.systemPrompt, ...systemMessages.map(extractTextFromUIMessage)]
      .filter(Boolean)
      .join('\n\n');

    let body: Record<string, unknown>;
    if (useResponsesApi) {
      const inputMessages = nonSystem.map(formatOpenAIResponsesInputMessage).filter(Boolean);
      body = { model: modelId, input: inputMessages, stream: true };
      if (allSystem) body.instructions = allSystem;
    } else {
      const chatMessages = nonSystem.map(formatOpenAIMessage).filter(Boolean);
      if (allSystem) chatMessages.unshift({ role: 'system', content: allSystem });
      body = { model: modelId, messages: chatMessages, stream: true };
    }

    return { url, headers, body };
  }

  private buildAnthropicRequest(
    messages: UIMessage[],
    apiKey: string,
    baseUrl: string,
    modelId: string,
  ): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    const url = buildAnthropicMessagesUrl(baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    const nonSystem = messages.filter(m => m.role !== 'system');
    const systemMessages = messages.filter(m => m.role === 'system');
    const allSystem = [this.options.systemPrompt, ...systemMessages.map(extractTextFromUIMessage)]
      .filter(Boolean)
      .join('\n\n');

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: 8192,
      messages: nonSystem.map(formatAnthropicMessage).filter(Boolean),
      stream: true,
    };
    if (allSystem) body.system = allSystem;

    return { url, headers, body };
  }

  private buildGeminiRequest(
    messages: UIMessage[],
    apiKey: string,
    baseUrl: string,
    modelId: string,
  ): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    const normalizedBaseUrl =
      baseUrl.trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${normalizedBaseUrl}/models/${modelId}:streamGenerateContent?alt=sse`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    };

    const nonSystem = messages.filter(m => m.role !== 'system');
    const systemMessages = messages.filter(m => m.role === 'system');
    const allSystem = [this.options.systemPrompt, ...systemMessages.map(extractTextFromUIMessage)]
      .filter(Boolean)
      .join('\n\n');

    const contents = nonSystem
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: extractTextFromUIMessage(msg).trim()
          ? [{ text: extractTextFromUIMessage(msg) }]
          : [],
      }))
      .filter(c => c.parts.length > 0);

    const body: Record<string, unknown> = { contents };
    if (allSystem) body.systemInstruction = { parts: [{ text: allSystem }] };
    body.generationConfig = { maxOutputTokens: 8192 };

    return { url, headers, body };
  }

  // -- Stream lifecycle -----------------------------------------------

  private streamOverIpc(
    chatId: string,
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    abortSignal: AbortSignal | undefined,
    apiFormat: 'anthropic' | 'openai' | 'gemini',
  ): ReadableStream<UIMessageChunk> {
    const requestId = `ipcchat_${chatId}_${Date.now()}`;
    const parser = new SseChunkParser(apiFormat);

    return new ReadableStream({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          controller.close();
          cleanup.forEach(fn => fn());
        };

        const cleanup: Array<() => void> = [];

        const removeData = window.electron.api.onStreamData(requestId, chunk => {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') {
              for (const c of parser.flush()) controller.enqueue(c);
              controller.enqueue({ type: 'finish', finishReason: 'stop' });
              close();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              for (const c of parser.feed(parsed)) {
                controller.enqueue(c);
              }
            } catch (e) {
              console.warn('[IpcChatTransport] Failed to parse SSE chunk:', e);
            }
          }
        });
        cleanup.push(removeData);

        const removeDone = window.electron.api.onStreamDone(requestId, () => {
          if (!closed) {
            for (const c of parser.flush()) controller.enqueue(c);
            controller.enqueue({ type: 'finish', finishReason: 'stop' });
          }
          close();
        });
        cleanup.push(removeDone);

        const removeError = window.electron.api.onStreamError(requestId, error => {
          const message = typeof error === 'string' ? error : error.message;
          controller.enqueue({ type: 'error', errorText: message });
          close();
        });
        cleanup.push(removeError);

        const removeAbort = window.electron.api.onStreamAbort(requestId, () => {
          if (!closed) {
            controller.enqueue({ type: 'abort', reason: 'user' });
          }
          close();
        });
        cleanup.push(removeAbort);

        window.electron.api
          .stream({
            url,
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            requestId,
          })
          .then(response => {
            if (!response.ok) {
              const message = response.error || `API request failed (${response.status})`;
              controller.enqueue({ type: 'error', errorText: message });
              close();
            }
          })
          .catch(error => {
            controller.enqueue({
              type: 'error',
              errorText: error instanceof Error ? error.message : String(error),
            });
            close();
          });

        const handleAbort = () => {
          void window.electron.api.cancelStream(requestId);
        };
        abortSignal?.addEventListener('abort', handleAbort, { once: true });
        cleanup.push(() => abortSignal?.removeEventListener('abort', handleAbort));
      },
    });
  }
}

// -- SSE chunk parser ------------------------------------------------
// Per-stream state machine that converts provider-specific SSE events
// into UIMessageChunk events.  Text, reasoning, tool calls, and errors
// are tracked by id so that deltas can be routed correctly.

type ToolCallState = {
  id: string;
  name: string;
  inputChunks: string[];
};

export class SseChunkParser {
  private apiFormat: 'anthropic' | 'openai' | 'gemini';

  // Track active output blocks by id
  private activeTextId: string | null = null;
  private activeReasoningId: string | null = null;
  private activeToolCall: ToolCallState | null = null;
  // Track tool calls started in current burst (for flush)
  private startedToolIds = new Set<string>();
  private startedReasoningIds = new Set<string>();
  private finished = false;

  constructor(apiFormat: 'anthropic' | 'openai' | 'gemini') {
    this.apiFormat = apiFormat;
  }

  feed(parsed: unknown): UIMessageChunk[] {
    if (this.apiFormat === 'anthropic') return this.feedAnthropic(parsed);
    if (this.apiFormat === 'gemini') return this.feedGemini(parsed);
    return this.feedOpenAI(parsed);
  }

  flush(): UIMessageChunk[] {
    if (this.finished) return [];
    const chunks: UIMessageChunk[] = [];

    this.closeReasoning(chunks);

    // Flush any pending tool call
    if (this.activeToolCall) {
      chunks.push({
        type: 'tool-input-available',
        toolCallId: this.activeToolCall.id,
        toolName: this.activeToolCall.name,
        input: this.activeToolCall.inputChunks.join(''),
      });
      this.activeToolCall = null;
    }
    this.finished = true;
    return chunks;
  }

  private closeReasoning(chunks: UIMessageChunk[]): void {
    if (!this.activeReasoningId) return;
    chunks.push({ type: 'reasoning-end', id: this.activeReasoningId });
    this.activeReasoningId = null;
  }

  // -- OpenAI / OpenAI-compatible ------------------------------------

  private feedOpenAI(parsed: unknown): UIMessageChunk[] {
    if (!parsed || typeof parsed !== 'object') return [];
    const chunks: UIMessageChunk[] = [];

    // OpenAI Responses output_text.delta
    const eventType = (parsed as { type?: string }).type;
    const deltaText = (parsed as { delta?: string }).delta;
    if (typeof deltaText === 'string' && deltaText && eventType === 'response.output_text.delta') {
      this.closeReasoning(chunks);
      if (!this.activeTextId) {
        this.activeTextId = generateId();
        chunks.push({ type: 'text-start', id: this.activeTextId });
      }
      chunks.push({ type: 'text-delta', id: this.activeTextId, delta: deltaText });
      return chunks;
    }

    // OpenAI error
    const error = (parsed as { error?: { message?: string } }).error;
    if (error) {
      chunks.push({ type: 'error', errorText: error.message || 'Unknown error' });
      return chunks;
    }

    // OpenAI chat completions choices
    const choices = (parsed as { choices?: Array<Record<string, unknown>> }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return [];

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;
    const finishReason = choice.finish_reason as string | null | undefined;

    if (delta) {
      // Reasoning
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        if (!this.activeReasoningId) {
          this.activeReasoningId = generateId();
          this.startedReasoningIds.add(this.activeReasoningId);
          chunks.push({ type: 'reasoning-start', id: this.activeReasoningId });
        }
        chunks.push({
          type: 'reasoning-delta',
          id: this.activeReasoningId,
          delta: delta.reasoning_content,
        });
      }

      // Text delta. An output text event closes the preceding reasoning segment.
      if (typeof delta.content === 'string' && delta.content) {
        this.closeReasoning(chunks);
        if (!this.activeTextId) {
          this.activeTextId = generateId();
          chunks.push({ type: 'text-start', id: this.activeTextId });
        }
        chunks.push({ type: 'text-delta', id: this.activeTextId, delta: delta.content });
      }

      // Tool calls
      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const tcIndex = tc.index as number;
          const tcId = tc.id as string | undefined;
          const tcFn = tc.function as { name?: string; arguments?: string } | undefined;

          // Start a tool call if we get index + function name
          if (tcFn?.name && this.activeToolCall?.inputChunks) {
            // Flush previous if different
            this.activeToolCall = {
              id: tcId || tcFn.name,
              name: tcFn.name,
              inputChunks: tcFn.arguments ? [tcFn.arguments] : [],
            };
          } else if (this.activeToolCall && tcFn?.arguments) {
            this.activeToolCall.inputChunks.push(tcFn.arguments);
          } else if (tcFn?.arguments && tcId && tcIndex >= 0) {
            // Start a new tool call from scratch
            this.activeToolCall = {
              id: tcId,
              name: tcFn.name || 'unknown',
              inputChunks: [tcFn.arguments],
            };
          }

          // If the tool call has a complete id, emit it
          if (this.activeToolCall && tcId && this.activeToolCall.id === tcId) {
            // We wait until the tool call input is complete (end of stream or next chunk)
          }
        }
      }
    }

    // Finish reason
    if (finishReason) {
      if (this.activeToolCall) {
        const rawInput = this.activeToolCall.inputChunks.join('');
        let parsedInput: unknown = rawInput;
        try {
          parsedInput = JSON.parse(rawInput);
        } catch {
          /* keep raw */
        }
        if (!this.startedToolIds.has(this.activeToolCall.id)) {
          this.startedToolIds.add(this.activeToolCall.id);
          chunks.push({
            type: 'tool-input-available',
            toolCallId: this.activeToolCall.id,
            toolName: this.activeToolCall.name,
            input: parsedInput,
          });
        }
        this.activeToolCall = null;
      }
    }

    return chunks;
  }

  // -- Anthropic -----------------------------------------------------

  private feedAnthropic(parsed: unknown): UIMessageChunk[] {
    if (!parsed || typeof parsed !== 'object') return [];
    const chunks: UIMessageChunk[] = [];
    const sseType = (parsed as { type?: string }).type;

    // Error
    const error = (parsed as { error?: { message?: string } }).error;
    if (error) {
      chunks.push({ type: 'error', errorText: error.message || 'Unknown error' });
      return chunks;
    }

    // Message start
    if (sseType === 'message_start') {
      return chunks;
    }

    // Content block start
    if (sseType === 'content_block_start') {
      const cb = (
        parsed as { content_block?: { type?: string; id?: string; name?: string; text?: string } }
      ).content_block;
      if (cb?.type === 'text') {
        this.closeReasoning(chunks);
        this.activeTextId = cb.id || generateId();
        chunks.push({ type: 'text-start', id: this.activeTextId });
      } else if (cb?.type === 'thinking') {
        this.activeReasoningId = cb.id || generateId();
        this.startedReasoningIds.add(this.activeReasoningId);
        chunks.push({ type: 'reasoning-start', id: this.activeReasoningId });
      } else if (cb?.type === 'tool_use') {
        this.closeReasoning(chunks);
        this.activeToolCall = {
          id: cb.id || generateId(),
          name: cb.name || 'unknown',
          inputChunks: [],
        };
      }
      return chunks;
    }

    // Content block delta
    if (sseType === 'content_block_delta') {
      const deltaObj = (
        parsed as {
          delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
        }
      ).delta;
      if (deltaObj?.type === 'text_delta' && typeof deltaObj.text === 'string') {
        this.closeReasoning(chunks);
        if (!this.activeTextId) {
          this.activeTextId = generateId();
          chunks.push({ type: 'text-start', id: this.activeTextId });
        }
        chunks.push({ type: 'text-delta', id: this.activeTextId, delta: deltaObj.text });
      } else if (deltaObj?.type === 'thinking_delta' && typeof deltaObj.thinking === 'string') {
        if (this.activeReasoningId) {
          chunks.push({
            type: 'reasoning-delta',
            id: this.activeReasoningId,
            delta: deltaObj.thinking,
          });
        }
      } else if (
        deltaObj?.type === 'input_json_delta' &&
        typeof deltaObj.partial_json === 'string' &&
        this.activeToolCall
      ) {
        this.activeToolCall.inputChunks.push(deltaObj.partial_json);
      }
      return chunks;
    }

    // Content block stop
    if (sseType === 'content_block_stop') {
      this.closeReasoning(chunks);
      if (this.activeToolCall) {
        const rawInput = this.activeToolCall.inputChunks.join('');
        let parsedInput: unknown = rawInput;
        try {
          parsedInput = JSON.parse(rawInput);
        } catch {
          /* keep raw */
        }
        if (!this.startedToolIds.has(this.activeToolCall.id)) {
          this.startedToolIds.add(this.activeToolCall.id);
          chunks.push({
            type: 'tool-input-available',
            toolCallId: this.activeToolCall.id,
            toolName: this.activeToolCall.name,
            input: parsedInput,
          });
        }
        this.activeToolCall = null;
      }
      return chunks;
    }

    // Message delta (stop reason)
    if (sseType === 'message_delta') {
      const delta = (parsed as { delta?: { stop_reason?: string } }).delta;
      const stopReason = delta?.stop_reason;
      if (stopReason === 'tool_use') {
        // Tool calls will be emitted by content_block_stop
      }
      return chunks;
    }

    return chunks;
  }

  // -- Gemini --------------------------------------------------------

  private feedGemini(parsed: unknown): UIMessageChunk[] {
    if (!parsed || typeof parsed !== 'object') return [];
    const chunks: UIMessageChunk[] = [];

    // Gemini error
    const error = (parsed as { error?: { message?: string } }).error;
    if (error) {
      chunks.push({ type: 'error', errorText: error.message || 'Unknown error' });
      return chunks;
    }

    const candidates = (parsed as { candidates?: Array<Record<string, unknown>> }).candidates;
    if (!Array.isArray(candidates)) return [];

    const parts = (
      candidates[0] as
        | {
            content?: {
              parts?: Array<{
                text?: string;
                thought?: boolean;
                functionCall?: { name: string; args: Record<string, unknown> };
              }>;
            };
          }
        | undefined
    )?.content?.parts;
    if (!parts) return [];

    for (const part of parts) {
      // Text
      if (typeof part.text === 'string' && !part.thought) {
        this.closeReasoning(chunks);
        if (!this.activeTextId) {
          this.activeTextId = generateId();
          chunks.push({ type: 'text-start', id: this.activeTextId });
        }
        chunks.push({ type: 'text-delta', id: this.activeTextId, delta: part.text });
      }
      // Reasoning (thought)
      if (typeof part.text === 'string' && part.thought) {
        if (!this.activeReasoningId) {
          this.activeReasoningId = generateId();
          this.startedReasoningIds.add(this.activeReasoningId);
          chunks.push({ type: 'reasoning-start', id: this.activeReasoningId });
        }
        chunks.push({ type: 'reasoning-delta', id: this.activeReasoningId, delta: part.text });
      }
      // Tool call
      if (part.functionCall) {
        const tcId = generateId();
        this.startedToolIds.add(tcId);
        chunks.push({
          type: 'tool-input-available',
          toolCallId: tcId,
          toolName: part.functionCall.name,
          input: part.functionCall.args,
        });
      }
    }

    return chunks;
  }
}
