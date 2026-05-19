import type {
  LlamaCppChatChunk,
  LlamaCppChatPayload,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
} from '../../shared/llamacpp';

type StreamCallback<T> = (chunk: T) => void;
type RequestOptions = { signal?: AbortSignal };

type LlamaCppRouterModel = {
  id?: string;
  path?: string;
  in_cache?: boolean;
  status?: {
    value?: string;
    args?: string[];
    failed?: boolean;
  };
  meta?: {
    n_params?: number;
    size?: number;
    n_ctx_train?: number;
  } | null;
};

type OpenAIChatCompletion = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: unknown[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  timings?: {
    prompt_n?: number;
    predicted_n?: number;
    predicted_per_second?: number;
  };
};

type OpenAIChatCompletionChunk = {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: unknown[];
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAIChatCompletion['usage'];
  timings?: OpenAIChatCompletion['timings'];
};

export class LlamaCppClient {
  private readonly baseUrl: string;

  constructor(baseUrl = 'http://127.0.0.1:8080') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async health(timeoutMs = 300): Promise<{ status?: string }> {
    return await this.requestJson('/health', { method: 'GET', timeoutMs });
  }

  async version(timeoutMs = 300): Promise<{ version?: string }> {
    await this.health(timeoutMs);
    return { version: 'llama.cpp' };
  }

  async listModels(): Promise<LlamaCppModel[]> {
    const payload = await this.requestJson<{ data?: LlamaCppRouterModel[] }>('/models?reload=1', { method: 'GET', timeoutMs: 30_000 });
    return (payload.data ?? []).map(toLlamaCppModel);
  }

  async runningModels(timeoutMs = 30_000): Promise<LlamaCppRunningModel[]> {
    const models = await this.listModelsWithTimeout(timeoutMs);
    return models.filter((model) => model.status === 'loaded' || model.status === 'loading' || model.status === 'sleeping');
  }

  async showModel(name: string): Promise<unknown> {
    return await this.requestJson(`/props?model=${encodeURIComponent(name)}`, { method: 'GET' });
  }

  async deleteModel(_name: string): Promise<void> {
    throw new Error('Model file deletion is managed by the llama.cpp manager.');
  }

  async loadModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelLaunchResult> {
    await this.requestJson('/models/load', {
      method: 'POST',
      timeoutMs: 300_000,
      body: JSON.stringify({ model: input.model }),
    });
    return { success: true, runningModels: await this.runningModels() };
  }

  async unloadModel(name: string, timeoutMs = 120_000): Promise<void> {
    await this.requestJson('/models/unload', {
      method: 'POST',
      timeoutMs,
      body: JSON.stringify({ model: name }),
    });
  }

  async chat(
    payload: LlamaCppChatPayload,
    onChunk?: StreamCallback<LlamaCppChatChunk>,
    options: RequestOptions = {},
  ): Promise<LlamaCppChatChunk | void> {
    const body = toOpenAIChatPayload(payload, Boolean(onChunk) && payload.stream !== false);
    if (!onChunk || payload.stream === false) {
      return toLlamaCppFinalChatChunk(await this.requestJson<OpenAIChatCompletion>('/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ ...body, stream: false }),
        signal: options.signal,
      }));
    }

    let sawDone = false;
    let sawDoneChunk = false;
    await this.requestSse('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
      signal: options.signal,
    }, (chunk) => {
      if (chunk === '[DONE]') {
        sawDone = true;
        if (!sawDoneChunk) {
          onChunk({ model: payload.model, done: true, done_reason: 'stop' });
        }
        return;
      }
      const parsed = JSON.parse(chunk) as OpenAIChatCompletionChunk;
      const mapped = toLlamaCppStreamChunk(parsed);
      if (mapped.done) {
        sawDone = true;
        sawDoneChunk = true;
      }
      onChunk(mapped);
    });
    if (!sawDone) {
      throw new Error('llama.cpp chat stream ended without a done chunk');
    }
  }

  private async listModelsWithTimeout(timeoutMs: number): Promise<LlamaCppModel[]> {
    const payload = await this.requestJson<{ data?: LlamaCppRouterModel[] }>('/models', { method: 'GET', timeoutMs });
    return (payload.data ?? []).map(toLlamaCppModel);
  }

  private async requestJson<T>(
    path: string,
    options: RequestInit & { timeoutMs?: number },
  ): Promise<T> {
    const response = await this.fetch(path, options);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private async requestSse(
    path: string,
    options: RequestInit & { timeoutMs?: number },
    onChunk: StreamCallback<string>,
  ): Promise<void> {
    const response = await this.fetch(path, options);
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const signal = options.signal;
    const cancelReader = (): void => {
      void reader.cancel(signal?.reason).catch((_error: unknown): void => undefined);
    };
    if (signal?.aborted) {
      cancelReader();
    } else {
      signal?.addEventListener('abort', cancelReader, { once: true });
    }
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          this.emitSseFrame(frame, onChunk);
        }
      }

      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('Generation cancelled');
      }

      buffer += decoder.decode();
      this.emitSseFrame(buffer, onChunk);
    } finally {
      signal?.removeEventListener('abort', cancelReader);
      reader.releaseLock();
    }
  }

  private emitSseFrame(frame: string, onChunk: StreamCallback<string>): void {
    const dataLines = frame
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim());
    for (const data of dataLines) {
      if (data) onChunk(data);
    }
  }

  private async fetch(path: string, options: RequestInit & { timeoutMs?: number }): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = options.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      abortFromExternal();
    } else {
      externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    try {
      const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`llama.cpp ${path} failed: HTTP ${response.status}${text ? ` ${text}` : ''}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }
}

function toOpenAIChatPayload(payload: LlamaCppChatPayload, stream: boolean): Record<string, unknown> {
  const options = payload.options ?? {};
  return {
    model: payload.model,
    messages: payload.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.thinking ? { reasoning_content: message.thinking } : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    })),
    stream,
    ...toOpenAIChatOptions(options),
  };
}

function toOpenAIChatOptions(options: Record<string, unknown>): Record<string, unknown> {
  const { num_predict: numPredict, max_tokens: maxTokens, ...rest } = options;
  return {
    ...rest,
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(maxTokens === undefined && numPredict !== undefined ? { max_tokens: numPredict } : {}),
  };
}

function toLlamaCppFinalChatChunk(response: OpenAIChatCompletion): LlamaCppChatChunk {
  const choice = response.choices?.[0];
  return {
    model: response.model,
    message: {
      role: 'assistant',
      content: choice?.message?.content ?? '',
      thinking: choice?.message?.reasoning_content ?? undefined,
      tool_calls: choice?.message?.tool_calls as LlamaCppChatChunk['message'] extends infer T
        ? T extends { tool_calls?: infer U } ? U : never
        : never,
    },
    done: true,
    done_reason: choice?.finish_reason ?? undefined,
    prompt_eval_count: response.usage?.prompt_tokens ?? response.timings?.prompt_n,
    eval_count: response.usage?.completion_tokens ?? response.timings?.predicted_n,
    predicted_per_second: response.timings?.predicted_per_second,
    usage: response.usage,
    timings: response.timings,
  };
}

function toLlamaCppStreamChunk(chunk: OpenAIChatCompletionChunk): LlamaCppChatChunk {
  const choice = chunk.choices?.[0];
  const finishReason = choice?.finish_reason ?? undefined;
  return {
    model: chunk.model,
    message: {
      role: 'assistant',
      content: choice?.delta?.content ?? '',
      thinking: choice?.delta?.reasoning_content ?? undefined,
      tool_calls: choice?.delta?.tool_calls as LlamaCppChatChunk['message'] extends infer T
        ? T extends { tool_calls?: infer U } ? U : never
        : never,
    },
    done: Boolean(finishReason || chunk.usage),
    done_reason: finishReason,
    prompt_eval_count: chunk.usage?.prompt_tokens ?? chunk.timings?.prompt_n,
    eval_count: chunk.usage?.completion_tokens ?? chunk.timings?.predicted_n,
    predicted_per_second: chunk.timings?.predicted_per_second,
    usage: chunk.usage,
    timings: chunk.timings,
  };
}

function toLlamaCppModel(model: LlamaCppRouterModel): LlamaCppModel {
  const name = model.id || model.path || 'unknown';
  const statusValue = model.status?.failed ? 'error' : model.status?.value;
  const status = isLlamaCppModelStatus(statusValue) ? statusValue : 'unloaded';
  return {
    name,
    id: name,
    model: name,
    path: model.path,
    size: model.meta?.size,
    source: model.in_cache ? 'cache' : 'local',
    status,
    args: model.status?.args,
    details: {
      format: 'gguf',
      parameter_size: typeof model.meta?.n_params === 'number'
        ? formatParameterCount(model.meta.n_params)
        : undefined,
      context_length: model.meta?.n_ctx_train,
    },
  };
}

function isLlamaCppModelStatus(value: unknown): value is LlamaCppModel['status'] {
  return value === 'loaded'
    || value === 'loading'
    || value === 'unloaded'
    || value === 'sleeping'
    || value === 'error';
}

function formatParameterCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return String(value);
}
