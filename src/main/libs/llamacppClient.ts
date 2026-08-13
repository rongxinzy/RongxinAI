import path from 'node:path';

import type {
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
} from '../../shared/llamacpp';

type LlamaCppClientOptions = {
  loadTimeoutMs?: number;
};

const LlamaCppModelStatus = {
  Loaded: 'loaded',
  Loading: 'loading',
  Unloaded: 'unloaded',
  Sleeping: 'sleeping',
  Error: 'error',
} as const;

const LLAMACPP_MODEL_LOAD_TIMEOUT_MS = 300_000;
const LLAMACPP_MODEL_READY_POLL_INTERVAL_MS = 250;
const LLAMACPP_MODEL_READY_POLL_REQUEST_TIMEOUT_MS = 10_000;
const LLAMACPP_MODEL_INFERENCE_PROBE_TIMEOUT_MS = 30_000;
const LLAMACPP_MODEL_PROPERTIES_TIMEOUT_MS = 2_000;
const LlamaCppInferenceProbeMessage = {
  Role: 'user',
  Content: 'ping',
} as const;

type LlamaCppRouterModel = {
  id?: string;
  path?: string;
  in_cache?: boolean;
  status?: {
    value?: string;
    args?: string[];
    n_ctx?: number;
    n_ctx_seq?: number;
    kv_unified?: boolean;
    failed?: boolean;
  };
  meta?: {
    n_params?: number;
    size?: number;
    n_ctx_train?: number;
  } | null;
};

export class LlamaCppClient {
  private readonly baseUrl: string;
  private readonly lastLoadRuntimeContextByModel = new Map<string, number>();
  private readonly loadTimeoutMs?: number;

  constructor(baseUrl = 'http://127.0.0.1:8080', options: LlamaCppClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.loadTimeoutMs = options.loadTimeoutMs;
  }

  async health(timeoutMs = 300): Promise<{ status?: string }> {
    return await this.requestJson('/health', { method: 'GET', timeoutMs });
  }

  async version(timeoutMs = 300): Promise<{ version?: string }> {
    await this.health(timeoutMs);
    return { version: 'llama.cpp' };
  }

  async listModels(options: { signal?: AbortSignal } = {}): Promise<LlamaCppModel[]> {
    const payload = await this.requestJson<{ data?: LlamaCppRouterModel[] }>('/models?reload=1', {
      method: 'GET',
      timeoutMs: this.loadTimeoutMs ?? 30_000,
      signal: options.signal,
    });
    return (payload.data ?? []).map(model =>
      toLlamaCppModel(
        model,
        this.lastLoadRuntimeContextByModel.get((model.id || model.path || 'unknown').trim()),
      ),
    );
  }

  async listModelsSnapshot(timeoutMs = 30_000): Promise<LlamaCppModel[]> {
    return await this.listModelsWithTimeout(timeoutMs);
  }

  async runningModels(timeoutMs = 30_000): Promise<LlamaCppRunningModel[]> {
    const models = await this.listModelsSnapshot(timeoutMs);
    return models.filter(isRunningModel);
  }

  async showModel(name: string): Promise<unknown> {
    return await this.requestJson(`/props?model=${encodeURIComponent(name)}`, {
      method: 'GET',
      timeoutMs: LLAMACPP_MODEL_PROPERTIES_TIMEOUT_MS,
    });
  }

  async deleteModel(_name: string): Promise<void> {
    throw new Error('Model file deletion is managed by the llama.cpp manager.');
  }

  async loadModel(
    input: LlamaCppModelLaunchInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<LlamaCppModelLaunchResult> {
    const modelName = input.model.trim();
    const timeoutMs = this.loadTimeoutMs ?? LLAMACPP_MODEL_LOAD_TIMEOUT_MS;
    await this.requestJson('/models/load', {
      method: 'POST',
      timeoutMs,
      signal: options.signal,
      body: JSON.stringify({ model: input.model }),
    });
    if (typeof input.options?.ctxSize === 'number' && input.options.ctxSize > 0) {
      this.lastLoadRuntimeContextByModel.set(modelName, input.options.ctxSize);
    }
    const runningModels = await this.waitForModelReady(modelName, timeoutMs, options.signal);
    try {
      await this.probeModelInference(modelName, options.signal);
    } catch (error) {
      // Treat a failed inference probe as a failed load so UI and server state stay aligned.
      await this.unloadModel(modelName).catch((): undefined => undefined);
      throw error;
    }
    return {
      success: true,
      runningModels,
    };
  }

  async unloadModel(name: string, timeoutMs = 120_000): Promise<void> {
    await this.requestJson('/models/unload', {
      method: 'POST',
      timeoutMs,
      body: JSON.stringify({ model: name }),
    });
  }

  private async listModelsWithTimeout(timeoutMs: number, signal?: AbortSignal): Promise<LlamaCppModel[]> {
    const payload = await this.requestJson<{ data?: LlamaCppRouterModel[] }>('/models', {
      method: 'GET',
      timeoutMs: timeoutMs || this.loadTimeoutMs || 30_000,
      signal,
    });
    return (payload.data ?? []).map(model =>
      toLlamaCppModel(
        model,
        this.lastLoadRuntimeContextByModel.get((model.id || model.path || 'unknown').trim()),
      ),
    );
  }

  /**
   * Poll with short requests so an unresponsive router cannot consume the full load deadline.
   */
  private async waitForModelReady(
    modelName: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<LlamaCppRunningModel[]> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`llama.cpp model ${modelName} did not become ready before timeout`);
      }
      const models = await this.listModelsWithTimeout(
        Math.min(remainingMs, LLAMACPP_MODEL_READY_POLL_REQUEST_TIMEOUT_MS),
        signal,
      );
      const targetModel = models.find(model => matchesModelName(model, modelName));
      if (
        targetModel?.status === LlamaCppModelStatus.Loaded ||
        targetModel?.status === LlamaCppModelStatus.Sleeping
      ) {
        return models.filter(isRunningModel);
      }
      if (targetModel?.status === LlamaCppModelStatus.Error) {
        throw new Error(`llama.cpp could not load model ${modelName}`);
      }
      const nextWaitMs = deadline - Date.now();
      if (nextWaitMs <= 0) {
        throw new Error(`llama.cpp model ${modelName} did not become ready before timeout`);
      }
      await waitFor(Math.min(LLAMACPP_MODEL_READY_POLL_INTERVAL_MS, nextWaitMs), signal);
    }
  }

  /**
   * A loaded router entry does not prove the model can complete a request.
   * Run a minimal OpenAI-compatible request before exposing it as ready.
   */
  private async probeModelInference(modelName: string, signal?: AbortSignal): Promise<void> {
    await this.requestJson('/v1/chat/completions', {
      method: 'POST',
      timeoutMs: Math.min(
        this.loadTimeoutMs ?? LLAMACPP_MODEL_LOAD_TIMEOUT_MS,
        LLAMACPP_MODEL_INFERENCE_PROBE_TIMEOUT_MS,
      ),
      signal,
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: LlamaCppInferenceProbeMessage.Role,
            content: LlamaCppInferenceProbeMessage.Content,
          },
        ],
        max_tokens: 1,
        stream: false,
      }),
    });
  }

  private async requestJson<T>(
    path: string,
    options: RequestInit & { timeoutMs?: number },
  ): Promise<T> {
    const response = await this.fetch(path, options);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async fetch(
    path: string,
    options: RequestInit & { timeoutMs?: number },
  ): Promise<Response> {
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
        throw new Error(
          `llama.cpp ${path} failed: HTTP ${response.status}${text ? ` ${text}` : ''}`,
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }
}

function toLlamaCppModel(
  model: LlamaCppRouterModel,
  fallbackRuntimeContextLength?: number,
): LlamaCppModel {
  const name = model.id || model.path || 'unknown';
  const statusValue = model.status?.failed ? LlamaCppModelStatus.Error : model.status?.value;
  const status = isLlamaCppModelStatus(statusValue) ? statusValue : LlamaCppModelStatus.Unloaded;
  const trainedContextLength = model.meta?.n_ctx_train;
  const runtimeContextLength = resolveRuntimeContextLength(model.status, fallbackRuntimeContextLength);
  return {
    name,
    id: name,
    model: name,
    path: model.path,
    size: model.meta?.size,
    source: model.in_cache ? 'cache' : 'local',
    status,
    args: model.status?.args,
    trained_context_length: trainedContextLength,
    runtime_context_length: runtimeContextLength,
    effective_options: runtimeContextLength ? { ctxSize: runtimeContextLength } : undefined,
    details: {
      format: 'gguf',
      parameter_size:
        typeof model.meta?.n_params === 'number'
          ? formatParameterCount(model.meta.n_params)
          : undefined,
      context_length: trainedContextLength,
    },
  };
}

function normalizeRuntimeContextLength(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function resolveRuntimeContextLength(
  status: LlamaCppRouterModel['status'],
  fallbackRuntimeContextLength?: number,
): number | undefined {
  const totalContextLength = normalizeRuntimeContextLength(status?.n_ctx);
  const slotContextLength = normalizeRuntimeContextLength(status?.n_ctx_seq);
  const args = status?.args ?? [];
  const unifiedKv = status?.kv_unified !== false && !args.includes('--no-kv-unified');

  return unifiedKv
    ? totalContextLength ?? slotContextLength ?? parseRuntimeContextLength(args) ?? fallbackRuntimeContextLength
    : slotContextLength ?? totalContextLength ?? parseRuntimeContextLength(args) ?? fallbackRuntimeContextLength;
}

function parseRuntimeContextLength(args: string[] | undefined): number | undefined {
  if (!Array.isArray(args) || args.length === 0) return undefined;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]?.trim() ?? '';
    if (!current) continue;

    if ((current === '--ctx-size' || current === '-c') && index + 1 < args.length) {
      const parsed = Number.parseInt(args[index + 1] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      continue;
    }

    const inlineMatch = current.match(/^--ctx-size=(\d+)$/);
    if (inlineMatch) {
      const parsed = Number.parseInt(inlineMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  return undefined;
}

function isLlamaCppModelStatus(value: unknown): value is LlamaCppModel['status'] {
  return (
    value === LlamaCppModelStatus.Loaded ||
    value === LlamaCppModelStatus.Loading ||
    value === LlamaCppModelStatus.Unloaded ||
    value === LlamaCppModelStatus.Sleeping ||
    value === LlamaCppModelStatus.Error
  );
}

function isRunningModel(model: LlamaCppModel): model is LlamaCppRunningModel {
  return (
    model.status === LlamaCppModelStatus.Loaded ||
    model.status === LlamaCppModelStatus.Loading ||
    model.status === LlamaCppModelStatus.Sleeping
  );
}

function matchesModelName(model: LlamaCppModel, modelName: string): boolean {
  const normalizedModelName = modelName.trim();
  const targetBaseName = path.basename(normalizedModelName);
  return [model.name, model.id, model.model, model.path].some(value => {
    const candidate = value?.trim();
    return candidate === normalizedModelName || path.basename(candidate ?? '') === targetBaseName;
  });
}

function waitFor(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timeout = setTimeout(complete, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function formatParameterCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return String(value);
}
