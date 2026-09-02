import {
  buildAnthropicMessagesUrl,
  isProviderEnabled,
  type ModelCapabilities,
  ModelCapabilityStatus,
  ProviderName,
  ProviderRegistry,
  resolveCodingPlanBaseUrl,
} from '../../shared/providers';
import { store } from '../store';
import type { Model } from '../store/slices/modelSlice';
import { ChatMessagePayload, ChatUserMessageInput, ImageAttachment } from '../types/chat';
import { configService } from './config';
import { i18nService } from './i18n';
import {
  buildLocalThinkingRequestParams,
  type DirectChatRequestOptions,
} from './localThinkingRequest';
import {
  LOCAL_INFERENCE_SLOT_RETRY_DELAYS_MS,
  shouldRetryLocalInferenceSlot,
  waitForLocalInferenceSlot,
} from './localInferenceSlotRetry';
import { probeRuntimeModelCapabilities } from './modelCapabilityProbe';
import { StreamRequestRegistry } from './streamRequestRegistry';
import { WebSearchToolEventType, type WebSearchToolEventHandler } from './webSearchToolEvents';

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  provider?: string;
  apiFormat?: 'anthropic' | 'openai' | 'gemini';
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 生成唯一的请求 ID
const generateRequestId = () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

class ApiService {
  private config: ApiConfig | null = null;
  private readonly streamRequests = new StreamRequestRegistry();
  private readonly runtimeCapabilityCache = new Map<string, Partial<ModelCapabilities>>();
  private readonly runtimeCapabilityRequests = new Map<
    string,
    Promise<Partial<ModelCapabilities>>
  >();
  private runtimeCapabilityGeneration = 0;

  setConfig(config: ApiConfig) {
    this.config = config;
    // Provider settings may have changed even when the legacy fallback config
    // is identical. Do not carry endpoint-specific capability evidence across
    // a settings refresh.
    this.runtimeCapabilityCache.clear();
    this.runtimeCapabilityRequests.clear();
    this.runtimeCapabilityGeneration += 1;
  }

  private getConfiguredApi(): ApiConfig {
    if (!this.config) {
      const appConfig = configService.getConfig();
      this.setConfig({
        apiKey: appConfig.api.key,
        baseUrl: appConfig.api.baseUrl,
      });
    }

    if (!this.config) {
      throw new ApiError(
        'API configuration not set. Please configure your API settings in the settings menu.',
      );
    }

    return this.config;
  }

  cancelOngoingRequest(requestId?: string) {
    const targetRequestId = requestId ?? this.streamRequests.getLatestRequestId();
    if (targetRequestId) {
      window.electron.api.cancelStream(targetRequestId);
      return true;
    }
    return false;
  }

  private cleanup(requestId: string | null) {
    this.streamRequests.cleanup(requestId);
  }

  private normalizeApiFormat(apiFormat: unknown): 'anthropic' | 'openai' | 'gemini' {
    if (apiFormat === 'openai') {
      return 'openai';
    }
    if (apiFormat === 'gemini') {
      return 'gemini';
    }
    return 'anthropic';
  }

  private supportsRuntimeCapabilityProbe(provider: string): boolean {
    return (
      provider === ProviderName.OpenRouter ||
      provider === ProviderName.Ollama ||
      provider === ProviderName.LlamaCpp
    );
  }

  private async getRuntimeModelCapabilities(
    provider: string,
    modelId: string,
    config: ApiConfig,
  ): Promise<Partial<ModelCapabilities>> {
    if (!this.supportsRuntimeCapabilityProbe(provider)) {
      return {};
    }

    const key = `${provider}\u0000${modelId}\u0000${config.baseUrl.trim()}`;
    const cached = this.runtimeCapabilityCache.get(key);
    if (cached) {
      return cached;
    }
    const pending = this.runtimeCapabilityRequests.get(key);
    if (pending) {
      return pending;
    }

    const generation = this.runtimeCapabilityGeneration;
    const request = probeRuntimeModelCapabilities(provider, modelId, config)
      .then(capabilities => {
        // An empty result is usually a transient fetch failure or an endpoint
        // that did not describe this model. Keep it retryable.
        if (
          generation === this.runtimeCapabilityGeneration &&
          Object.keys(capabilities).length > 0
        ) {
          this.runtimeCapabilityCache.set(key, capabilities);
        }
        return capabilities;
      })
      .finally(() => {
        if (this.runtimeCapabilityRequests.get(key) === request) {
          this.runtimeCapabilityRequests.delete(key);
        }
      });
    this.runtimeCapabilityRequests.set(key, request);
    return request;
  }

  private async resolveRequestModelCapabilities(
    provider: string,
    model: Model,
    config: ApiConfig,
  ): Promise<ModelCapabilities> {
    const apiFormat = this.normalizeApiFormat(config.apiFormat);
    const declared = ProviderRegistry.resolveModelCapabilities(
      provider,
      model.id,
      apiFormat,
      model,
    );
    const detected = await this.getRuntimeModelCapabilities(provider, model.id, config);
    return { ...declared, ...detected };
  }

  private buildOpenAICompatibleChatCompletionsUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (!normalized) {
      return '/v1/chat/completions';
    }
    if (normalized.endsWith('/chat/completions')) {
      return normalized;
    }

    // Handle /v1, /v4 etc. versioned paths
    if (/\/v\d+$/.test(normalized)) {
      return `${normalized}/chat/completions`;
    }
    return `${normalized}/v1/chat/completions`;
  }

  private buildOpenAIResponsesUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (!normalized) {
      return '/v1/responses';
    }
    if (normalized.endsWith('/responses')) {
      return normalized;
    }
    if (normalized.endsWith('/v1')) {
      return `${normalized}/responses`;
    }
    return `${normalized}/v1/responses`;
  }

  private shouldUseOpenAIResponsesApi(provider: string): boolean {
    return provider === 'openai';
  }

  private buildImageHint(images?: ImageAttachment[]): string {
    if (!images?.length) return '';
    return `[images: ${images.length}]`;
  }

  private mergeContentWithImageHint(content: string, images?: ImageAttachment[]): string {
    const hint = this.buildImageHint(images);
    if (!hint) return content;
    if (!content?.trim()) return hint;
    return `${content}\n\n${hint}`;
  }

  private extractImageData(image: ImageAttachment): { mimeType: string; data: string } | null {
    if (!image?.dataUrl) return null;
    const match = /^data:(.+);base64,(.*)$/.exec(image.dataUrl);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
    if (image.type && image.dataUrl) {
      return { mimeType: image.type, data: image.dataUrl };
    }
    return null;
  }

  private formatOpenAIMessage(message: ChatMessagePayload, supportsImages: boolean) {
    if (supportsImages && message.images?.length) {
      const parts: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [];
      if (message.content?.trim()) {
        parts.push({ type: 'text', text: message.content });
      }
      message.images.forEach(image => {
        if (image.dataUrl) {
          parts.push({ type: 'image_url', image_url: { url: image.dataUrl } });
        }
      });
      if (!parts.length) return null;
      return { role: message.role, content: parts };
    }

    const content = supportsImages
      ? message.content
      : this.mergeContentWithImageHint(message.content, message.images);
    if (!content?.trim()) return null;
    return { role: message.role, content };
  }

  private formatOpenAIResponsesInputMessage(message: ChatMessagePayload, supportsImages: boolean) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';

    if (role === 'user' && supportsImages && message.images?.length) {
      const parts: Array<
        { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }
      > = [];
      if (message.content?.trim()) {
        parts.push({ type: 'input_text', text: message.content });
      }
      message.images.forEach(image => {
        if (image.dataUrl) {
          parts.push({ type: 'input_image', image_url: image.dataUrl });
        }
      });
      if (!parts.length) return null;
      return { role, content: parts };
    }

    const content = supportsImages
      ? message.content
      : this.mergeContentWithImageHint(message.content, message.images);
    if (!content?.trim()) return null;
    if (role === 'assistant') {
      return { role, content: [{ type: 'output_text', text: content }] };
    }
    return { role, content: [{ type: 'input_text', text: content }] };
  }

  private extractResponsesOutputText(payload: any): string {
    const directOutputText = typeof payload?.output_text === 'string' ? payload.output_text : '';
    if (directOutputText) {
      return directOutputText;
    }

    const nestedOutputText =
      typeof payload?.response?.output_text === 'string' ? payload.response.output_text : '';
    if (nestedOutputText) {
      return nestedOutputText;
    }

    const output = Array.isArray(payload?.response?.output)
      ? payload.response.output
      : Array.isArray(payload?.output)
        ? payload.output
        : [];
    if (!Array.isArray(output)) {
      return '';
    }

    const chunks: string[] = [];
    output.forEach((item: any) => {
      if (!Array.isArray(item?.content)) {
        return;
      }
      item.content.forEach((contentItem: any) => {
        if (typeof contentItem?.text === 'string' && contentItem.text) {
          chunks.push(contentItem.text);
        }
      });
    });
    return chunks.join('');
  }

  private formatAnthropicMessage(message: ChatMessagePayload, supportsImages: boolean) {
    if (message.role === 'system') return null;
    if (supportsImages && message.images?.length) {
      const blocks: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      > = [];
      if (message.content?.trim()) {
        blocks.push({ type: 'text', text: message.content });
      }
      message.images.forEach(image => {
        const payload = this.extractImageData(image);
        if (payload) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: payload.mimeType,
              data: payload.data,
            },
          });
        }
      });
      if (!blocks.length) return null;
      return { role: message.role, content: blocks };
    }

    const content = supportsImages
      ? message.content
      : this.mergeContentWithImageHint(message.content, message.images);
    if (!content?.trim()) return null;
    return { role: message.role, content };
  }

  private providerRequiresApiKey(provider: string): boolean {
    return (
      provider !== ProviderName.Ollama &&
      provider !== ProviderName.LlamaCpp &&
      provider !== ProviderName.Copilot &&
      !provider.startsWith('custom_')
    );
  }

  // 检测当前选择的模型属于哪个 provider
  private detectProvider(modelId: string, providerHint?: string): string {
    const normalizedHint = providerHint?.trim().toLowerCase();
    if (
      normalizedHint &&
      (ProviderRegistry.get(normalizedHint) !== undefined ||
        normalizedHint === ProviderName.LlamaCpp ||
        normalizedHint === ProviderName.Custom ||
        normalizedHint.startsWith('custom_'))
    ) {
      return normalizedHint;
    }
    const normalizedModelId = modelId.toLowerCase();
    if (normalizedModelId.startsWith('claude')) {
      return 'anthropic';
    } else if (
      normalizedModelId.startsWith('gpt') ||
      normalizedModelId.startsWith('o1') ||
      normalizedModelId.startsWith('o3') ||
      normalizedModelId.startsWith('o4')
    ) {
      return 'openai';
    } else if (normalizedModelId.startsWith('gemini')) {
      return 'gemini';
    } else if (normalizedModelId.startsWith('grok')) {
      return 'grok';
    } else if (normalizedModelId.startsWith('deepseek')) {
      return 'deepseek';
    } else if (normalizedModelId.startsWith('kimi-')) {
      return 'moonshot';
    } else if (normalizedModelId.startsWith('glm-')) {
      return 'zhipu';
    } else if (normalizedModelId.startsWith('minimax')) {
      return 'minimax';
    } else if (normalizedModelId.startsWith('qwen') || normalizedModelId.startsWith('qvq')) {
      return 'qwen';
    } else if (normalizedModelId.startsWith('mimo') || normalizedModelId.includes('xiaomi')) {
      return 'xiaomi';
    } else if (normalizedModelId.startsWith('step-')) {
      return 'stepfun';
    } else if (
      normalizedModelId.startsWith('doubao') ||
      normalizedModelId.includes('volcengine') ||
      normalizedModelId.includes('ep-') ||
      normalizedModelId.startsWith('ark-')
    ) {
      return 'volcengine';
    }
    return 'openai'; // 默认使用 OpenAI 兼容格式
  }

  // 获取指定 provider 的配置
  private getProviderConfig(provider: string): ApiConfig | null {
    const appConfig = configService.getConfig();

    if (appConfig?.providers?.[provider]) {
      const providerConfig = appConfig.providers[provider];
      if (
        isProviderEnabled(provider, providerConfig) &&
        (providerConfig.apiKey || !this.providerRequiresApiKey(provider))
      ) {
        let baseUrl = providerConfig.baseUrl;
        let apiFormat = this.normalizeApiFormat(providerConfig.apiFormat);

        if (
          providerConfig.codingPlanEnabled &&
          (apiFormat === 'anthropic' || apiFormat === 'openai')
        ) {
          const resolved = resolveCodingPlanBaseUrl(provider, true, apiFormat, baseUrl);
          baseUrl = resolved.baseUrl;
          apiFormat = resolved.effectiveFormat;
        }

        return {
          apiKey: providerConfig.apiKey,
          baseUrl,
          provider: provider,
          apiFormat,
        };
      }
    }

    return null;
  }

  async chat(
    message: string | ChatUserMessageInput,
    onProgress?: (content: string, reasoning?: string) => void,
    history: ChatMessagePayload[] = [],
    options: DirectChatRequestOptions = {},
    streamRequestId?: string,
  ): Promise<{
    content: string;
    reasoning?: string;
    usage?: TokenUsage;
  }> {
    const configuredApi = this.getConfiguredApi();

    const modelState = store.getState().model;
    const requestedModelId = options.modelId?.trim();
    const requestedProviderKey = options.modelProviderKey?.trim();
    const selectedModel = requestedModelId
      ? (modelState.availableModels.find(
          model =>
            (model.id === requestedModelId ||
              `${model.provider}/${model.id}` === requestedModelId) &&
            (!requestedProviderKey || model.providerKey === requestedProviderKey),
        ) ?? modelState.defaultSelectedModel)
      : modelState.defaultSelectedModel;
    const provider = this.detectProvider(
      selectedModel.id,
      selectedModel.providerKey ?? selectedModel.provider,
    );
    const userMessage: ChatUserMessageInput =
      typeof message === 'string'
        ? { content: message }
        : { content: message.content || '', images: message.images };

    // 尝试获取模型对应 provider 的配置
    let effectiveConfig = configuredApi;
    const providerConfig = this.getProviderConfig(provider);
    if (providerConfig) {
      effectiveConfig = providerConfig;
    }

    if (this.providerRequiresApiKey(provider) && !effectiveConfig.apiKey) {
      throw new ApiError(
        'API key is not configured. Please set your API key in the settings menu.',
      );
    }

    // 根据 API 协议格式决定调用方式：
    // - anthropic: Anthropic 兼容协议 (/v1/messages)
    // - openai: OpenAI 兼容协议 (OpenAI provider uses /v1/responses)
    // - gemini: Google Gemini 原生协议 (streamGenerateContent)
    const normalizedApiFormat = this.normalizeApiFormat(effectiveConfig.apiFormat);
    const capabilities = await this.resolveRequestModelCapabilities(
      provider,
      selectedModel,
      effectiveConfig,
    );
    const supportsImages = capabilities.imageInput === ModelCapabilityStatus.Supported;
    console.log(
      `[api-chat] provider=${provider}, model=${selectedModel.id}, apiFormat=${normalizedApiFormat}, baseUrl=${effectiveConfig.baseUrl}`,
    );

    if (normalizedApiFormat === 'gemini') {
      return this.chatWithGemini(
        userMessage,
        onProgress,
        history,
        selectedModel.id,
        effectiveConfig,
        supportsImages,
        streamRequestId,
      );
    }

    if (normalizedApiFormat === 'anthropic') {
      return this.chatWithAnthropic(
        userMessage,
        onProgress,
        history,
        selectedModel.id,
        effectiveConfig,
        supportsImages,
        streamRequestId,
      );
    }

    try {
      return await this.chatWithOpenAICompatible(
        userMessage,
        onProgress,
        history,
        selectedModel.id,
        effectiveConfig,
        supportsImages,
        provider,
        options,
        streamRequestId,
      );
    } catch (error) {
      if (
        provider === ProviderName.LlamaCpp &&
        error instanceof ApiError &&
        shouldRetryLocalInferenceSlot(error)
      ) {
        let lastError = error;
        for (const delayMs of LOCAL_INFERENCE_SLOT_RETRY_DELAYS_MS) {
          await waitForLocalInferenceSlot(delayMs);
          try {
            return await this.chatWithOpenAICompatible(
              userMessage,
              onProgress,
              history,
              selectedModel.id,
              effectiveConfig,
              supportsImages,
              provider,
              options,
              streamRequestId,
            );
          } catch (retryError) {
            if (!(retryError instanceof ApiError) || !shouldRetryLocalInferenceSlot(retryError)) {
              throw retryError;
            }
            lastError = retryError;
          }
        }
        throw lastError;
      }

      // Auto-retry once for GitHub Copilot auth errors (401 / token expired)
      if (
        provider === 'github-copilot' &&
        error instanceof ApiError &&
        (error.statusCode === 401 || error.statusCode === 403)
      ) {
        console.log('[api-chat] Copilot auth error detected, attempting token refresh and retry');
        try {
          const result = await window.electron.githubCopilot.refreshToken();
          if (result.success && result.token) {
            // Update local config with the refreshed token
            const refreshedConfig: ApiConfig = {
              ...effectiveConfig,
              apiKey: result.token,
              ...(result.baseUrl ? { baseUrl: result.baseUrl } : {}),
            };
            return await this.chatWithOpenAICompatible(
              userMessage,
              onProgress,
              history,
              selectedModel.id,
              refreshedConfig,
              supportsImages,
              provider,
              options,
              streamRequestId,
            );
          }
        } catch (refreshError) {
          console.warn(
            '[api-chat] Copilot token refresh failed, throwing original error:',
            refreshError,
          );
        }
      }
      throw error;
    }
  }

  /** Native provider tool loop; the gateway credential stays in the main process. */
  async chatWithWebSearch(
    message: string | ChatUserMessageInput,
    onProgress?: (content: string, reasoning?: string) => void,
    history: ChatMessagePayload[] = [],
    options: DirectChatRequestOptions = {},
    requestId: string = generateRequestId(),
    abortSignal?: AbortSignal,
    onToolEvent?: WebSearchToolEventHandler,
  ): Promise<{
    content: string;
    reasoning?: string;
    usage?: TokenUsage;
  }> {
    const configuredApi = this.getConfiguredApi();
    const modelState = store.getState().model;
    const requestedModelId = options.modelId?.trim();
    const requestedProviderKey = options.modelProviderKey?.trim();
    const selectedModel = requestedModelId
      ? (modelState.availableModels.find(
          model =>
            (model.id === requestedModelId ||
              `${model.provider}/${model.id}` === requestedModelId) &&
            (!requestedProviderKey || model.providerKey === requestedProviderKey),
        ) ?? modelState.defaultSelectedModel)
      : modelState.defaultSelectedModel;
    const provider = this.detectProvider(
      selectedModel.id,
      selectedModel.providerKey ?? selectedModel.provider,
    );
    const config = this.getProviderConfig(provider) ?? configuredApi;
    if (this.providerRequiresApiKey(provider) && !config.apiKey) {
      throw new ApiError(
        'API key is not configured. Please set your API key in the settings menu.',
      );
    }
    const apiFormat = this.normalizeApiFormat(config.apiFormat);
    const capabilities = await this.resolveRequestModelCapabilities(
      provider,
      selectedModel,
      config,
    );
    const supportsImages = capabilities.imageInput === ModelCapabilityStatus.Supported;
    if (capabilities.toolCalling !== ModelCapabilityStatus.Supported) {
      const capabilityMessage =
        capabilities.toolCalling === ModelCapabilityStatus.Unsupported
          ? `${i18nService.t('toolCapabilityUnsupportedFallback')}\n\n`
          : `${i18nService.t('toolCapabilityUnknownFallback')}\n\n`;
      // Keep the request valid for custom, aggregated, and local endpoints. The
      // regular chat path deliberately contains no `tools` or `tool_choice`.
      onProgress?.(capabilityMessage);
      return this.chat(message, onProgress, history, options, requestId);
    }
    const prompt =
      'Use the web_search tool when current, factual, or external information would improve the answer. Cite result URLs when you use search.';
    const system = [
      prompt,
      ...history.filter(item => item.role === 'system').map(item => item.content),
    ]
      .filter(Boolean)
      .join('\n');
    const userMessage: ChatMessagePayload = {
      role: 'user',
      content: typeof message === 'string' ? message : message.content,
      ...(typeof message === 'string' || !message.images?.length ? {} : { images: message.images }),
    };

    if (apiFormat === 'anthropic') {
      const messages = [...history.filter(item => item.role !== 'system'), userMessage]
        .map(item => this.formatAnthropicMessage(item, supportsImages))
        .filter(Boolean) as any[];
      return this.runAnthropicWebSearchLoop(
        messages,
        system,
        selectedModel.id,
        config,
        onProgress,
        requestId,
        abortSignal,
        onToolEvent,
      );
    }
    if (apiFormat === 'gemini') {
      const contents = [...history.filter(item => item.role !== 'system'), userMessage].map(
        item => ({
          role: item.role === 'assistant' ? 'model' : 'user',
          parts: [
            ...(item.content ? [{ text: item.content }] : []),
            ...(item.images ?? []).flatMap(image => {
              const payload = this.extractImageData(image);
              return payload
                ? [{ inline_data: { mime_type: payload.mimeType, data: payload.data } }]
                : [];
            }),
          ],
        }),
      );
      return this.runGeminiWebSearchLoop(
        contents,
        system,
        selectedModel.id,
        config,
        onProgress,
        requestId,
        abortSignal,
        onToolEvent,
      );
    }
    if (this.shouldUseOpenAIResponsesApi(provider)) {
      const input = [...history.filter(item => item.role !== 'system'), userMessage]
        .map(item => this.formatOpenAIResponsesInputMessage(item, supportsImages))
        .filter(Boolean) as any[];
      return this.runOpenAIResponsesWebSearchLoop(
        input,
        system,
        selectedModel.id,
        config,
        onProgress,
        requestId,
        abortSignal,
        onToolEvent,
      );
    }
    const messages = [
      { role: 'system', content: system },
      ...history
        .filter(item => item.role !== 'system')
        .map(item => this.formatOpenAIMessage(item, supportsImages))
        .filter(Boolean),
      ...[this.formatOpenAIMessage(userMessage, supportsImages)].filter(Boolean),
    ];
    return this.runOpenAIWebSearchLoop(
      messages,
      selectedModel.id,
      config,
      provider,
      onProgress,
      requestId,
      abortSignal,
      onToolEvent,
    );
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
  }

  private async consumeSse(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    requestId: string,
    onEvent: (event: any) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    this.throwIfAborted(abortSignal);
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';

      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.cleanup(requestId);
        if (error) reject(error);
        else resolve();
      };
      const parseBuffer = (flush = false) => {
        const lines = buffer.split('\n');
        buffer = flush ? '' : (lines.pop() ?? '');
        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            onEvent(JSON.parse(data));
          } catch {
            // Ignore keepalives and provider-specific non-JSON SSE frames.
          }
        }
      };

      const removeData = window.electron.api.onStreamData(requestId, chunk => {
        buffer += chunk;
        parseBuffer();
      });
      const removeDone = window.electron.api.onStreamDone(requestId, () => {
        parseBuffer(true);
        settle();
      });
      const removeError = window.electron.api.onStreamError(requestId, error => {
        settle(new ApiError(typeof error === 'string' ? error : error.message));
      });
      const removeAbort = window.electron.api.onStreamAbort(requestId, () => {
        settle(new DOMException('The request was aborted.', 'AbortError'));
      });
      const handleSignalAbort = () => {
        void window.electron.api.cancelStream(requestId);
        settle(new DOMException('The request was aborted.', 'AbortError'));
      };
      abortSignal?.addEventListener('abort', handleSignalAbort, { once: true });
      const removeSignalAbort = () => abortSignal?.removeEventListener('abort', handleSignalAbort);
      this.streamRequests.register(requestId, [
        removeData,
        removeDone,
        removeError,
        removeAbort,
        removeSignalAbort,
      ]);

      if (abortSignal?.aborted) {
        handleSignalAbort();
        return;
      }
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
            settle(new ApiError(response.error || response.statusText, response.status));
          }
        })
        .catch(error => {
          settle(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private async streamOpenAIChatResponse(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    requestId: string,
    onProgress?: (content: string, reasoning?: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<any> {
    let content = '';
    let reasoningContent = '';
    let reasoning = '';
    let usage: Record<string, unknown> | undefined;
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    await this.consumeSse(
      url,
      headers,
      { ...body, stream: true },
      requestId,
      event => {
        if (event?.usage && typeof event.usage === 'object') {
          usage = event.usage;
        }
        const delta = event?.choices?.[0]?.delta;
        if (!delta) return;
        if (typeof delta.content === 'string') content += delta.content;
        const reasoningContentDelta =
          typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
        const reasoningDelta = typeof delta.reasoning === 'string' ? delta.reasoning : '';
        reasoningContent += reasoningContentDelta;
        reasoning += reasoningDelta;
        const fullReasoning = `${reasoningContent}${reasoning}`;
        if (delta.content || reasoningContentDelta || reasoningDelta) {
          onProgress?.(content, fullReasoning || undefined);
        }
        if (Array.isArray(delta.tool_calls)) {
          delta.tool_calls.forEach((toolCall: any) => {
            const index = typeof toolCall.index === 'number' ? toolCall.index : calls.size;
            const current = calls.get(index) || { id: '', name: '', arguments: '' };
            if (toolCall.id) current.id = toolCall.id;
            if (toolCall.function?.name) current.name = toolCall.function.name;
            if (toolCall.function?.arguments) {
              current.arguments += toolCall.function.arguments;
            }
            calls.set(index, current);
          });
        }
      },
      abortSignal,
    );
    return {
      ...(usage ? { usage } : {}),
      choices: [
        {
          message: {
            role: 'assistant',
            content: content || null,
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
            ...(reasoning ? { reasoning } : {}),
            ...(calls.size
              ? {
                  tool_calls: [...calls.values()].map(call => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: call.arguments },
                  })),
                }
              : {}),
          },
        },
      ],
    };
  }

  private async streamOpenAIResponsesResponse(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    requestId: string,
    onProgress?: (content: string, reasoning?: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<any> {
    let content = '';
    let reasoning = '';
    let completedOutput: any[] | null = null;
    let usage: Record<string, unknown> | undefined;
    const output = new Map<number, any>();
    await this.consumeSse(
      url,
      headers,
      { ...body, stream: true },
      requestId,
      event => {
        const responseUsage = event?.usage ?? event?.response?.usage;
        if (responseUsage && typeof responseUsage === 'object') {
          usage = responseUsage;
        }
        const type = event?.type;
        if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
          content += event.delta;
          onProgress?.(content, reasoning || undefined);
        } else if (
          type === 'response.reasoning_summary_text.delta' &&
          typeof event.delta === 'string'
        ) {
          reasoning += event.delta;
          onProgress?.(content, reasoning);
        } else if (type === 'response.output_item.added' && event.item) {
          output.set(event.output_index ?? output.size, { ...event.item });
        } else if (
          type === 'response.function_call_arguments.delta' &&
          typeof event.delta === 'string'
        ) {
          const index = event.output_index ?? 0;
          const item = output.get(index) || {
            type: 'function_call',
            arguments: '',
          };
          item.arguments = `${item.arguments || ''}${event.delta}`;
          output.set(index, item);
        } else if (type === 'response.output_item.done' && event.item) {
          output.set(event.output_index ?? output.size, event.item);
        } else if (type === 'response.completed' && Array.isArray(event.response?.output)) {
          completedOutput = event.response.output;
        }
      },
      abortSignal,
    );
    return {
      ...(usage ? { usage } : {}),
      output_text: content,
      output:
        completedOutput || [...output.entries()].sort(([a], [b]) => a - b).map(([, item]) => item),
    };
  }

  private async streamAnthropicResponse(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    requestId: string,
    onProgress?: (content: string, reasoning?: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<any> {
    const blocks = new Map<number, any>();
    let text = '';
    let reasoning = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cacheReadTokens: number | undefined;
    let cacheWriteTokens: number | undefined;
    await this.consumeSse(
      url,
      headers,
      { ...body, stream: true },
      requestId,
      event => {
        const eventUsage = event?.usage ?? event?.message?.usage;
        if (eventUsage && typeof eventUsage === 'object') {
          if (typeof eventUsage.input_tokens === 'number') {
            inputTokens = eventUsage.input_tokens;
          }
          if (typeof eventUsage.output_tokens === 'number') {
            outputTokens = eventUsage.output_tokens;
          }
          if (typeof eventUsage.cache_read_input_tokens === 'number') {
            cacheReadTokens = eventUsage.cache_read_input_tokens;
          }
          if (typeof eventUsage.cache_creation_input_tokens === 'number') {
            cacheWriteTokens = eventUsage.cache_creation_input_tokens;
          }
        }
        const index = typeof event?.index === 'number' ? event.index : 0;
        if (event?.type === 'content_block_start' && event.content_block) {
          blocks.set(index, { ...event.content_block });
        } else if (event?.type === 'content_block_delta') {
          const block = blocks.get(index) || {};
          if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
            block.type = 'text';
            block.text = `${block.text || ''}${event.delta.text}`;
            text += event.delta.text;
            onProgress?.(text, reasoning || undefined);
          } else if (
            event.delta?.type === 'thinking_delta' &&
            typeof event.delta.thinking === 'string'
          ) {
            block.type = 'thinking';
            block.thinking = `${block.thinking || ''}${event.delta.thinking}`;
            reasoning += event.delta.thinking;
            onProgress?.(text, reasoning);
          } else if (
            event.delta?.type === 'signature_delta' &&
            typeof event.delta.signature === 'string'
          ) {
            block.signature = `${block.signature || ''}${event.delta.signature}`;
          } else if (
            event.delta?.type === 'input_json_delta' &&
            typeof event.delta.partial_json === 'string'
          ) {
            block.inputJson = `${block.inputJson || ''}${event.delta.partial_json}`;
          }
          blocks.set(index, block);
        }
      },
      abortSignal,
    );
    const content = [...blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, block]) => {
        if (block.type !== 'tool_use') return block;
        const { inputJson, ...toolBlock } = block;
        let input = {};
        try {
          input = inputJson ? JSON.parse(inputJson) : block.input || {};
        } catch {
          input = {};
        }
        return { ...toolBlock, input };
      });
    return {
      content,
      ...(inputTokens !== undefined && outputTokens !== undefined
        ? {
            usage: {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              ...(cacheReadTokens !== undefined
                ? { cache_read_input_tokens: cacheReadTokens }
                : {}),
              ...(cacheWriteTokens !== undefined
                ? { cache_creation_input_tokens: cacheWriteTokens }
                : {}),
            },
          }
        : {}),
    };
  }

  private async streamGeminiResponse(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    requestId: string,
    onProgress?: (content: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<any> {
    let text = '';
    let usageMetadata: Record<string, unknown> | undefined;
    const functionCalls: any[] = [];
    await this.consumeSse(
      `${url}?alt=sse`,
      headers,
      body,
      requestId,
      event => {
        if (event?.usageMetadata && typeof event.usageMetadata === 'object') {
          usageMetadata = event.usageMetadata;
        }
        const parts = event?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return;
        parts.forEach((part: any) => {
          if (typeof part.text === 'string') {
            text += part.text;
            onProgress?.(text);
          }
          if (part.functionCall) functionCalls.push(part);
        });
      },
      abortSignal,
    );
    return {
      ...(usageMetadata ? { usageMetadata } : {}),
      candidates: [
        {
          content: {
            role: 'model',
            parts: [...(text ? [{ text }] : []), ...functionCalls],
          },
        },
      ],
    };
  }

  private async executeWebSearch(
    call: { query?: unknown; max_results?: unknown },
    requestId: string,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    this.throwIfAborted(abortSignal);
    const response = await window.electron.api.webSearch({
      query: typeof call.query === 'string' ? call.query : '',
      ...(typeof call.max_results === 'number' ? { maxResults: call.max_results } : {}),
      requestId,
    });
    this.throwIfAborted(abortSignal);
    return response.ok
      ? response.data
      : { error: response.error || 'Search is temporarily unavailable.' };
  }

  private webSearchTool() {
    return {
      name: 'web_search',
      description:
        'Search the public web for up-to-date information. Returns titles, URLs, and short extracts.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Precise search query.' },
          max_results: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    };
  }

  private async executeSearchCalls(
    calls: Array<{
      toolCallId: string;
      args: { query?: unknown; max_results?: unknown };
    }>,
    requestId: string,
    abortSignal?: AbortSignal,
    onToolEvent?: WebSearchToolEventHandler,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const input = call.args as Record<string, unknown>;
      onToolEvent?.({ type: WebSearchToolEventType.Start, toolCallId: call.toolCallId, input });
      try {
        const result =
          index < 3
            ? await this.executeWebSearch(call.args, requestId, abortSignal)
            : { error: 'Only three web_search calls are allowed per model turn.' };
        results.push(result);
        if (
          result &&
          typeof result === 'object' &&
          typeof (result as { error?: unknown }).error === 'string'
        ) {
          onToolEvent?.({
            type: WebSearchToolEventType.Error,
            toolCallId: call.toolCallId,
            error: (result as { error: string }).error,
          });
        } else {
          onToolEvent?.({
            type: WebSearchToolEventType.Complete,
            toolCallId: call.toolCallId,
            output: result,
          });
        }
      } catch (error) {
        onToolEvent?.({
          type: WebSearchToolEventType.Error,
          toolCallId: call.toolCallId,
          error: error instanceof Error ? error.message : 'Web search failed.',
        });
        throw error;
      }
    }
    return results;
  }

  private async runOpenAIResponsesWebSearchLoop(
    input: any[],
    instructions: string,
    model: string,
    config: ApiConfig,
    onProgress: ((content: string) => void) | undefined,
    requestId: string,
    abortSignal?: AbortSignal,
    onToolEvent?: WebSearchToolEventHandler,
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
    const tool = this.webSearchTool();
    for (let turn = 0; turn < 4; turn += 1) {
      const data = await this.streamOpenAIResponsesResponse(
        this.buildOpenAIResponsesUrl(config.baseUrl),
        headers,
        {
          model,
          input,
          instructions,
          tools: [{ type: 'function', ...tool, strict: true }],
        },
        requestId,
        onProgress,
        abortSignal,
      );
      const output = Array.isArray(data?.output) ? data.output : [];
      const functionCalls = output.filter(
        (item: any) => item?.type === 'function_call' && item.name === 'web_search',
      );
      if (!functionCalls.length) {
        const content = this.extractResponsesOutputText(data);
        onProgress?.(content);
        const inputTokens = data?.usage?.input_tokens;
        const outputTokens = data?.usage?.output_tokens;
        return {
          content,
          ...(typeof inputTokens === 'number' && typeof outputTokens === 'number'
            ? { usage: { inputTokens, outputTokens } }
            : {}),
        };
      }
      input.push(...output);
      const parsedCalls = functionCalls.map((call: any, index: number) => {
        let args = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          args = {};
        }
        return {
          toolCallId: call.call_id || `${requestId}-web-search-${turn}-${index}`,
          args,
        };
      });
      const results = await this.executeSearchCalls(
        parsedCalls,
        requestId,
        abortSignal,
        onToolEvent,
      );
      functionCalls.forEach((_call: any, index: number) => {
        input.push({
          type: 'function_call_output',
          call_id: parsedCalls[index].toolCallId,
          output: JSON.stringify(results[index]),
        });
      });
    }
    throw new ApiError('Search tool call limit reached.');
  }

  private async runOpenAIWebSearchLoop(
    messages: any[],
    model: string,
    config: ApiConfig,
    provider: string,
    onProgress: ((content: string) => void) | undefined,
    requestId: string,
    abortSignal?: AbortSignal,
    onToolEvent?: WebSearchToolEventHandler,
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
    if (provider === ProviderName.Copilot) {
      headers['Copilot-Integration-Id'] = 'vscode-chat';
      headers['Editor-Version'] = 'vscode/1.96.2';
      headers['Editor-Plugin-Version'] = 'copilot-chat/0.26.7';
      headers['User-Agent'] = 'GitHubCopilotChat/0.26.7';
      headers['Openai-Intent'] = 'conversation-panel';
    }
    for (let turn = 0; turn < 4; turn += 1) {
      let data: any;
      let attempt = 0;
      while (true) {
        try {
          data = await this.streamOpenAIChatResponse(
            this.buildOpenAICompatibleChatCompletionsUrl(config.baseUrl),
            headers,
            {
              model,
              messages,
              tools: [{ type: 'function', function: this.webSearchTool() }],
            },
            requestId,
            onProgress,
            abortSignal,
          );
          break;
        } catch (error) {
          if (
            provider !== ProviderName.LlamaCpp ||
            !(error instanceof ApiError) ||
            !shouldRetryLocalInferenceSlot(error) ||
            attempt >= LOCAL_INFERENCE_SLOT_RETRY_DELAYS_MS.length
          ) {
            throw error;
          }
          await waitForLocalInferenceSlot(LOCAL_INFERENCE_SLOT_RETRY_DELAYS_MS[attempt]);
          this.throwIfAborted(abortSignal);
          attempt += 1;
        }
      }
      const assistant = data?.choices?.[0]?.message;
      if (!assistant) {
        throw new ApiError('No content received from the API. Please try again.');
      }
      const calls = Array.isArray(assistant.tool_calls)
        ? assistant.tool_calls.filter((call: any) => call?.function?.name === 'web_search')
        : [];
      messages.push(
        provider === ProviderName.DeepSeek && calls.length
          ? {
              ...assistant,
              content: typeof assistant.content === 'string' ? assistant.content : '',
            }
          : assistant,
      );
      if (!calls.length) {
        const content = typeof assistant.content === 'string' ? assistant.content : '';
        onProgress?.(content);
        const inputTokens = data?.usage?.prompt_tokens ?? data?.usage?.input_tokens;
        const outputTokens = data?.usage?.completion_tokens ?? data?.usage?.output_tokens;
        return {
          content,
          ...(typeof inputTokens === 'number' && typeof outputTokens === 'number'
            ? { usage: { inputTokens, outputTokens } }
            : {}),
        };
      }
      const parsedCalls = calls.map((call: any, index: number) => {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        return {
          toolCallId: call.id || `${requestId}-web-search-${turn}-${index}`,
          args,
        };
      });
      const results = await this.executeSearchCalls(
        parsedCalls,
        requestId,
        abortSignal,
        onToolEvent,
      );
      calls.forEach((_call: any, index: number) => {
        messages.push({
          role: 'tool',
          tool_call_id: parsedCalls[index].toolCallId,
          content: JSON.stringify(results[index]),
        });
      });
    }
    throw new ApiError('Search tool call limit reached.');
  }

  private async runAnthropicWebSearchLoop(
    messages: any[],
    system: string,
    model: string,
    config: ApiConfig,
    onProgress: ((content: string) => void) | undefined,
    requestId: string,
    abortSignal?: AbortSignal,
    onToolEvent?: WebSearchToolEventHandler,
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    };
    for (let turn = 0; turn < 4; turn += 1) {
      const tool = this.webSearchTool();
      const data = await this.streamAnthropicResponse(
        buildAnthropicMessagesUrl(config.baseUrl),
        headers,
        {
          model,
          max_tokens: 8192,
          system,
          messages,
          tools: [
            {
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            },
          ],
        },
        requestId,
        onProgress,
        abortSignal,
      );
      const content = Array.isArray(data?.content) ? data.content : [];
      const calls = content.filter(
        (block: any) => block?.type === 'tool_use' && block.name === 'web_search',
      );
      if (!calls.length) {
        const text = content
          .filter((block: any) => block?.type === 'text')
          .map((block: any) => block.text)
          .join('');
        onProgress?.(text);
        const inputTokens = data?.usage?.input_tokens;
        const outputTokens = data?.usage?.output_tokens;
        const cacheReadTokens = data?.usage?.cache_read_input_tokens;
        const cacheWriteTokens = data?.usage?.cache_creation_input_tokens;
        return {
          content: text,
          ...(typeof inputTokens === 'number' && typeof outputTokens === 'number'
            ? {
                usage: {
                  inputTokens,
                  outputTokens,
                  ...(typeof cacheReadTokens === 'number' ? { cacheReadTokens } : {}),
                  ...(typeof cacheWriteTokens === 'number' ? { cacheWriteTokens } : {}),
                },
              }
            : {}),
        };
      }
      messages.push({ role: 'assistant', content });
      const parsedCalls = calls.map((call: any, index: number) => ({
        toolCallId: call.id || `${requestId}-web-search-${turn}-${index}`,
        args: call.input || {},
      }));
      const results = await this.executeSearchCalls(
        parsedCalls,
        requestId,
        abortSignal,
        onToolEvent,
      );
      messages.push({
        role: 'user',
        content: calls.map((_call: any, index: number) => ({
          type: 'tool_result',
          tool_use_id: parsedCalls[index].toolCallId,
          content: JSON.stringify(results[index]),
        })),
      });
    }
    throw new ApiError('Search tool call limit reached.');
  }

  private async runGeminiWebSearchLoop(
    contents: any[],
    system: string,
    model: string,
    config: ApiConfig,
    onProgress: ((content: string) => void) | undefined,
    requestId: string,
    abortSignal?: AbortSignal,
    onToolEvent?: WebSearchToolEventHandler,
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const baseUrl =
      config.baseUrl.trim().replace(/\/+$/, '') ||
      'https://generativelanguage.googleapis.com/v1beta';
    const tool = this.webSearchTool();
    for (let turn = 0; turn < 4; turn += 1) {
      const data = await this.streamGeminiResponse(
        `${baseUrl}/models/${model}:streamGenerateContent`,
        {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        {
          contents,
          systemInstruction: { parts: [{ text: system }] },
          tools: [
            {
              functionDeclarations: [
                {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 8192 },
        },
        requestId,
        onProgress,
        abortSignal,
      );
      const content = data?.candidates?.[0]?.content;
      const calls = Array.isArray(content?.parts)
        ? content.parts.filter((part: any) => part.functionCall?.name === 'web_search')
        : [];
      if (!calls.length) {
        const text = (content?.parts || [])
          .filter((part: any) => typeof part.text === 'string')
          .map((part: any) => part.text)
          .join('');
        onProgress?.(text);
        const inputTokens = data?.usageMetadata?.promptTokenCount;
        const outputTokens = data?.usageMetadata?.candidatesTokenCount;
        return {
          content: text,
          ...(typeof inputTokens === 'number' && typeof outputTokens === 'number'
            ? { usage: { inputTokens, outputTokens } }
            : {}),
        };
      }
      contents.push(content);
      const results = await this.executeSearchCalls(
        calls.map((part: any, index: number) => ({
          toolCallId: `${requestId}-web-search-${turn}-${index}`,
          args: part.functionCall.args || {},
        })),
        requestId,
        abortSignal,
        onToolEvent,
      );
      contents.push({
        role: 'user',
        parts: calls.map((_part: any, index: number) => ({
          functionResponse: { name: 'web_search', response: results[index] },
        })),
      });
    }
    throw new ApiError('Search tool call limit reached.');
  }

  // Anthropic API 调用
  private async chatWithAnthropic(
    message: ChatUserMessageInput,
    onProgress?: (content: string, reasoning?: string) => void,
    history: ChatMessagePayload[] = [],
    modelId: string = 'claude-3-5-sonnet-20241022',
    config: ApiConfig = this.config!,
    supportsImages: boolean = false,
    streamRequestId?: string,
  ): Promise<{
    content: string;
    reasoning?: string;
    usage?: TokenUsage;
  }> {
    let fullContent = '';
    let fullReasoning = '';
    let usage: TokenUsage | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cacheReadTokens: number | undefined;
    let cacheWriteTokens: number | undefined;

    try {
      const requestId = streamRequestId ?? generateRequestId();

      // Anthropic 需要将 history 中的 system 消息分离出来
      const systemMessages = history.filter(m => m.role === 'system');
      const nonSystemMessages = history.filter(m => m.role !== 'system');

      const formattedHistory = nonSystemMessages
        .map(item => this.formatAnthropicMessage(item, supportsImages))
        .filter(Boolean);
      const formattedUserMessage = this.formatAnthropicMessage(
        {
          role: 'user',
          content: message.content,
          images: message.images,
        },
        supportsImages,
      );
      const messages = [
        ...formattedHistory,
        ...(formattedUserMessage ? [formattedUserMessage] : []),
      ];

      const requestBody: any = {
        model: modelId,
        max_tokens: 8192,
        messages: messages,
        stream: true,
      };

      // 添加 system 消息
      if (systemMessages.length > 0) {
        const systemContent = systemMessages
          .map(m =>
            this.mergeContentWithImageHint(m.content, supportsImages ? undefined : m.images),
          )
          .filter(Boolean)
          .join('\n');
        if (systemContent) {
          requestBody.system = systemContent;
        }
      }

      // 检测是否是 thinking 模型
      const isThinkingModel =
        modelId.includes('claude-3-7') ||
        modelId.includes('claude-sonnet-4') ||
        modelId.includes('claude-opus-4');

      if (isThinkingModel) {
        requestBody.thinking = {
          type: 'enabled',
          budget_tokens: 10000,
        };
        // Thinking 模型需要更大的 max_tokens
        requestBody.max_tokens = 16000;
      }

      return new Promise((resolve, reject) => {
        let aborted = false;

        // 设置流式监听器
        const removeDataListener = window.electron.api.onStreamData(requestId, chunk => {
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const responseUsage = parsed.usage ?? parsed.message?.usage;
                if (responseUsage && typeof responseUsage === 'object') {
                  if (typeof responseUsage.input_tokens === 'number') {
                    inputTokens = responseUsage.input_tokens;
                  }
                  if (typeof responseUsage.output_tokens === 'number') {
                    outputTokens = responseUsage.output_tokens;
                  }
                  if (typeof responseUsage.cache_read_input_tokens === 'number') {
                    cacheReadTokens = responseUsage.cache_read_input_tokens;
                  }
                  if (typeof responseUsage.cache_creation_input_tokens === 'number') {
                    cacheWriteTokens = responseUsage.cache_creation_input_tokens;
                  }
                  if (inputTokens !== undefined && outputTokens !== undefined) {
                    usage = {
                      inputTokens,
                      outputTokens,
                      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
                      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
                    };
                  }
                }

                // Anthropic SSE 事件处理
                if (parsed.type === 'content_block_delta') {
                  const delta = parsed.delta;
                  if (delta.type === 'text_delta') {
                    fullContent += delta.text;
                    onProgress?.(fullContent, fullReasoning || undefined);
                  } else if (delta.type === 'thinking_delta') {
                    fullReasoning += delta.thinking;
                    onProgress?.(fullContent, fullReasoning || undefined);
                  }
                }
              } catch (e) {
                console.warn('Failed to parse SSE message:', e);
              }
            }
          }
        });

        const removeDoneListener = window.electron.api.onStreamDone(requestId, () => {
          this.cleanup(requestId);
          if (!fullContent && !fullReasoning) {
            reject(new ApiError('No content received from the API. Please try again.'));
          } else {
            resolve({ content: fullContent, reasoning: fullReasoning || undefined, usage });
          }
        });

        const removeErrorListener = window.electron.api.onStreamError(requestId, error => {
          this.cleanup(requestId);
          reject(new ApiError(typeof error === 'string' ? error : error.message));
        });

        const removeAbortListener = window.electron.api.onStreamAbort(requestId, () => {
          aborted = true;
          this.cleanup(requestId);
          resolve({
            content: fullContent || 'Response was stopped.',
            reasoning: fullReasoning || undefined,
          });
        });

        this.streamRequests.register(requestId, [
          removeDataListener,
          removeDoneListener,
          removeErrorListener,
          removeAbortListener,
        ]);

        // 发起流式请求
        const requestUrl = buildAnthropicMessagesUrl(config.baseUrl);
        console.log(
          `[api-chat] Anthropic request: baseUrl=${config.baseUrl}, finalUrl=${requestUrl}, model=${modelId}, apiFormat=${config.apiFormat}`,
        );
        window.electron.api
          .stream({
            url: requestUrl,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(requestBody),
            requestId,
          })
          .then(response => {
            if (!response.ok && !aborted) {
              this.cleanup(requestId);
              let errorMessage = 'API request failed';
              if (response.error) {
                try {
                  const errorData = JSON.parse(response.error);
                  if (errorData.error?.message) {
                    errorMessage = errorData.error.message;
                  }
                } catch {
                  errorMessage = response.error;
                }
              }
              reject(new ApiError(errorMessage, response.status));
            }
          })
          .catch(error => {
            if (!aborted) {
              this.cleanup(requestId);
              reject(new ApiError(error.message || 'Network error'));
            }
          });
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('An unexpected error occurred while calling the API. Please try again.');
    }
  }

  // Gemini native API 调用 (streamGenerateContent)
  private async chatWithGemini(
    message: ChatUserMessageInput,
    onProgress?: (content: string, reasoning?: string) => void,
    history: ChatMessagePayload[] = [],
    modelId: string = 'gemini-3-pro-preview',
    config: ApiConfig = this.config!,
    supportsImages: boolean = false,
    streamRequestId?: string,
  ): Promise<{
    content: string;
    reasoning?: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    let fullContent = '';
    let fullReasoning = '';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      const requestId = streamRequestId ?? generateRequestId();

      const systemMessages = history.filter(m => m.role === 'system');
      const nonSystemMessages = history.filter(m => m.role !== 'system');

      const formatGeminiParts = (msg: ChatMessagePayload): Array<Record<string, unknown>> => {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content?.trim()) {
          parts.push({ text: msg.content });
        }
        if (supportsImages && msg.images?.length) {
          msg.images.forEach(image => {
            const payload = this.extractImageData(image);
            if (payload) {
              parts.push({ inline_data: { mime_type: payload.mimeType, data: payload.data } });
            }
          });
        } else if (!supportsImages && msg.images?.length) {
          const hint = this.buildImageHint(msg.images);
          if (hint && !msg.content?.trim()) {
            parts.push({ text: hint });
          }
        }
        return parts;
      };

      const contents = [
        ...nonSystemMessages.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: formatGeminiParts(msg),
        })),
        {
          role: 'user',
          parts: formatGeminiParts({
            role: 'user',
            content: message.content,
            images: message.images,
          }),
        },
      ].filter(c => c.parts.length > 0);

      const requestBody: Record<string, unknown> = { contents };

      if (systemMessages.length > 0) {
        const systemContent = systemMessages
          .map(m =>
            this.mergeContentWithImageHint(m.content, supportsImages ? undefined : m.images),
          )
          .filter(Boolean)
          .join('\n');
        if (systemContent) {
          requestBody.systemInstruction = { parts: [{ text: systemContent }] };
        }
      }

      requestBody.generationConfig = { maxOutputTokens: 8192 };

      const baseUrl =
        config.baseUrl.trim().replace(/\/+$/, '') ||
        'https://generativelanguage.googleapis.com/v1beta';
      const requestUrl = `${baseUrl}/models/${modelId}:streamGenerateContent?alt=sse`;

      return new Promise((resolve, reject) => {
        let aborted = false;

        const removeDataListener = window.electron.api.onStreamData(requestId, chunk => {
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const usageMetadata = parsed.usageMetadata;
                if (usageMetadata && typeof usageMetadata === 'object') {
                  const inputTokens = usageMetadata.promptTokenCount;
                  const outputTokens = usageMetadata.candidatesTokenCount;
                  if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
                    usage = { inputTokens, outputTokens };
                  }
                }
                const candidate = parsed.candidates?.[0];
                if (!candidate?.content?.parts) continue;

                for (const part of candidate.content.parts) {
                  if (part.thought === true && typeof part.text === 'string') {
                    fullReasoning += part.text;
                  } else if (typeof part.text === 'string') {
                    fullContent += part.text;
                  }
                }
                onProgress?.(fullContent, fullReasoning || undefined);
              } catch (e) {
                console.warn('Failed to parse Gemini SSE message:', e);
              }
            }
          }
        });

        const removeDoneListener = window.electron.api.onStreamDone(requestId, () => {
          this.cleanup(requestId);
          if (!fullContent && !fullReasoning) {
            reject(new ApiError('No content received from the API. Please try again.'));
          } else {
            resolve({ content: fullContent, reasoning: fullReasoning || undefined, usage });
          }
        });

        const removeErrorListener = window.electron.api.onStreamError(requestId, error => {
          this.cleanup(requestId);
          reject(new ApiError(typeof error === 'string' ? error : error.message));
        });

        const removeAbortListener = window.electron.api.onStreamAbort(requestId, () => {
          aborted = true;
          this.cleanup(requestId);
          resolve({
            content: fullContent || 'Response was stopped.',
            reasoning: fullReasoning || undefined,
          });
        });

        this.streamRequests.register(requestId, [
          removeDataListener,
          removeDoneListener,
          removeErrorListener,
          removeAbortListener,
        ]);

        console.log(
          `[api-chat] Gemini request: baseUrl=${config.baseUrl}, finalUrl=${requestUrl}, model=${modelId}`,
        );
        window.electron.api
          .stream({
            url: requestUrl,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey,
            },
            body: JSON.stringify(requestBody),
            requestId,
          })
          .then(response => {
            if (!response.ok && !aborted) {
              this.cleanup(requestId);
              let errorMessage = 'API request failed';
              if (response.error) {
                try {
                  const errorData = JSON.parse(response.error);
                  if (errorData.error?.message) {
                    errorMessage = errorData.error.message;
                  }
                } catch {
                  errorMessage = response.error;
                }
              }
              reject(new ApiError(errorMessage, response.status));
            }
          })
          .catch(error => {
            if (!aborted) {
              this.cleanup(requestId);
              reject(new ApiError(error.message || 'Network error'));
            }
          });
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('An unexpected error occurred while calling the API. Please try again.');
    }
  }

  // OpenAI 兼容 API 调用 (OpenAI, DeepSeek, etc.)
  private async chatWithOpenAICompatible(
    message: ChatUserMessageInput,
    onProgress?: (content: string, reasoning?: string) => void,
    history: ChatMessagePayload[] = [],
    modelId: string = 'gpt-4',
    config: ApiConfig = this.config!,
    supportsImages: boolean = false,
    provider: string = 'openai',
    options: DirectChatRequestOptions = {},
    streamRequestId?: string,
    includeUsage: boolean = true,
  ): Promise<{
    content: string;
    reasoning?: string;
    usage?: TokenUsage;
  }> {
    let fullContent = '';
    let fullReasoning = '';
    let usage: TokenUsage | undefined;

    try {
      const requestId = streamRequestId ?? generateRequestId();
      const useResponsesApi = this.shouldUseOpenAIResponsesApi(provider);

      const userMessage: ChatMessagePayload = {
        role: 'user',
        content: message.content,
        images: message.images,
      };
      const messages = [...history, userMessage]
        .map(item => this.formatOpenAIMessage(item, supportsImages))
        .filter(Boolean);
      const systemInstructions = history
        .filter(item => item.role === 'system')
        .map(item =>
          this.mergeContentWithImageHint(item.content, supportsImages ? undefined : item.images),
        )
        .filter(Boolean)
        .join('\n');
      const responseInputMessages = [...history.filter(item => item.role !== 'system'), userMessage]
        .map(item => this.formatOpenAIResponsesInputMessage(item, supportsImages))
        .filter(Boolean);

      return new Promise((resolve, reject) => {
        let aborted = false;
        let sseBuffer = '';
        let currentEvent = '';

        // 设置流式监听器
        const removeDataListener = window.electron.api.onStreamData(requestId, chunk => {
          sseBuffer += chunk;
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (!line) {
              currentEvent = '';
              continue;
            }
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (!line.startsWith('data: ')) {
              continue;
            }

            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              if (useResponsesApi) {
                const responseUsage = parsed.usage ?? parsed.response?.usage;
                if (responseUsage && typeof responseUsage === 'object') {
                  const inputTokens = responseUsage.input_tokens;
                  const outputTokens = responseUsage.output_tokens;
                  if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
                    usage = { inputTokens, outputTokens };
                  }
                }
                const eventType = currentEvent || String(parsed.type || '');
                const content =
                  (eventType === 'response.output_text.delta' ||
                    eventType === 'response.output.delta') &&
                  typeof parsed.delta === 'string'
                    ? parsed.delta
                    : '';
                const reasoning =
                  eventType === 'response.reasoning_summary_text.delta' &&
                  typeof parsed.delta === 'string'
                    ? parsed.delta
                    : '';
                const completedText =
                  eventType === 'response.completed' || eventType === 'response.output_item.done'
                    ? this.extractResponsesOutputText(parsed)
                    : '';

                if (content) {
                  fullContent += content;
                }
                if (reasoning) {
                  fullReasoning += reasoning;
                }
                if (!fullContent && completedText) {
                  fullContent = completedText;
                }
                if (content || reasoning || completedText) {
                  onProgress?.(fullContent, fullReasoning || undefined);
                }
                continue;
              }

              const delta = parsed.choices?.[0]?.delta || {};
              const responseUsage = parsed.usage;
              if (responseUsage && typeof responseUsage === 'object') {
                const inputTokens =
                  typeof responseUsage.prompt_tokens === 'number'
                    ? responseUsage.prompt_tokens
                    : typeof responseUsage.input_tokens === 'number'
                      ? responseUsage.input_tokens
                      : undefined;
                const outputTokens =
                  typeof responseUsage.completion_tokens === 'number'
                    ? responseUsage.completion_tokens
                    : typeof responseUsage.output_tokens === 'number'
                      ? responseUsage.output_tokens
                      : undefined;
                if (inputTokens !== undefined && outputTokens !== undefined) {
                  usage = { inputTokens, outputTokens };
                }
              }
              const content = typeof delta.content === 'string' ? delta.content : '';
              const reasoning =
                typeof delta.reasoning_content === 'string'
                  ? delta.reasoning_content
                  : typeof delta.reasoning === 'string'
                    ? delta.reasoning
                    : typeof delta.thoughts === 'string'
                      ? delta.thoughts
                      : '';

              if (content) {
                fullContent += content;
              }
              if (reasoning) {
                fullReasoning += reasoning;
              }
              if (content || reasoning) {
                onProgress?.(fullContent, fullReasoning || undefined);
              }
            } catch (e) {
              console.warn('Failed to parse SSE message:', e);
            }
          }
        });

        const removeDoneListener = window.electron.api.onStreamDone(requestId, () => {
          this.cleanup(requestId);
          if (!fullContent && !fullReasoning) {
            reject(new ApiError('No content received from the API. Please try again.'));
          } else {
            resolve({ content: fullContent, reasoning: fullReasoning || undefined, usage });
          }
        });

        const removeErrorListener = window.electron.api.onStreamError(requestId, error => {
          this.cleanup(requestId);
          reject(new ApiError(typeof error === 'string' ? error : error.message));
        });

        const removeAbortListener = window.electron.api.onStreamAbort(requestId, () => {
          aborted = true;
          this.cleanup(requestId);
          resolve({
            content: fullContent || 'Response was stopped.',
            reasoning: fullReasoning || undefined,
            usage,
          });
        });

        this.streamRequests.register(requestId, [
          removeDataListener,
          removeDoneListener,
          removeErrorListener,
          removeAbortListener,
        ]);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (config.apiKey) {
          if (provider === 'gemini') {
            headers['x-goog-api-key'] = config.apiKey;
          } else {
            headers.Authorization = `Bearer ${config.apiKey}`;
          }
        }
        if (provider === 'github-copilot') {
          headers['Copilot-Integration-Id'] = 'vscode-chat';
          headers['Editor-Version'] = 'vscode/1.96.2';
          headers['Editor-Plugin-Version'] = 'copilot-chat/0.26.7';
          headers['User-Agent'] = 'GitHubCopilotChat/0.26.7';
          headers['Openai-Intent'] = 'conversation-panel';
        }

        const requestUrl = useResponsesApi
          ? this.buildOpenAIResponsesUrl(config.baseUrl)
          : this.buildOpenAICompatibleChatCompletionsUrl(config.baseUrl);
        console.log(
          `[api-chat] OpenAI-compat request: provider=${provider}, baseUrl=${config.baseUrl}, finalUrl=${requestUrl}, model=${modelId}, apiFormat=${config.apiFormat}`,
        );
        const requestBody: Record<string, unknown> = useResponsesApi
          ? {
              model: modelId,
              input: responseInputMessages,
              stream: true,
            }
          : {
              model: modelId,
              messages: messages,
              stream: true,
            };
        if (useResponsesApi && systemInstructions) {
          requestBody.instructions = systemInstructions;
        }
        Object.assign(
          requestBody,
          buildLocalThinkingRequestParams(provider, options.localThinkingEnabled),
        );
        if (!useResponsesApi && includeUsage) {
          requestBody.stream_options = { include_usage: true };
        }

        window.electron.api
          .stream({
            url: requestUrl,
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            requestId,
          })
          .then(async response => {
            if (!response.ok && !aborted) {
              this.cleanup(requestId);
              let errorMessage = 'API request failed';
              if (response.error) {
                try {
                  const errorData = JSON.parse(response.error);
                  if (errorData.error?.message) {
                    errorMessage = errorData.error.message;
                  }
                } catch {
                  errorMessage = response.error;
                }
              }
              if (
                !useResponsesApi &&
                includeUsage &&
                /stream_options|include_usage|unknown (field|parameter)|extra fields/i.test(
                  errorMessage,
                )
              ) {
                try {
                  resolve(
                    await this.chatWithOpenAICompatible(
                      message,
                      onProgress,
                      history,
                      modelId,
                      config,
                      supportsImages,
                      provider,
                      options,
                      streamRequestId,
                      false,
                    ),
                  );
                } catch (retryError) {
                  reject(retryError);
                }
                return;
              }
              reject(new ApiError(errorMessage, response.status));
            }
          })
          .catch(error => {
            if (!aborted) {
              this.cleanup(requestId);
              reject(new ApiError(error.message || 'Network error'));
            }
          });
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('An unexpected error occurred while calling the API. Please try again.');
    }
  }
}

export const apiService = new ApiService();
