import { afterEach, expect, test, vi } from 'vitest';

import { ModelCapabilityStatus, ProviderName } from '../../shared/providers';
import { store } from '../store';
import { setAvailableModels, setDefaultSelectedModel } from '../store/slices/modelSlice';
import { apiService } from './api';
import { i18nService } from './i18n';

afterEach(() => {
  i18nService.setLanguage('zh', { persist: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('unknown tool capability falls back to regular chat without a tool payload', async () => {
  const model = {
    id: 'custom-unknown',
    name: 'Custom Unknown',
    providerKey: 'custom_0',
    supportsImage: false,
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({ apiKey: 'key', baseUrl: 'https://example.test/v1', apiFormat: 'openai' });
  const regularChat = vi.spyOn(apiService, 'chat').mockResolvedValue({ content: 'plain answer' });
  const stream = vi.spyOn(apiService as any, 'streamOpenAIChatResponse');
  const progress = vi.fn();

  await expect(apiService.chatWithWebSearch('latest news', progress)).resolves.toEqual({
    content: 'plain answer',
  });

  expect(regularChat).toHaveBeenCalledOnce();
  expect(stream).not.toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith(
    '当前模型的工具调用能力尚未确认，已改用普通对话，未执行联网搜索。\n\n',
  );
});

test('explicit supported capability keeps the native tool loop enabled', async () => {
  const model = {
    id: 'custom-tools',
    name: 'Custom Tools',
    providerKey: 'custom_0',
    supportsImage: false,
    capabilities: { toolCalling: ModelCapabilityStatus.Supported },
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({ apiKey: 'key', baseUrl: 'https://example.test/v1', apiFormat: 'openai' });
  const loop = vi
    .spyOn(apiService as any, 'runOpenAIWebSearchLoop')
    .mockResolvedValue({ content: 'searched answer' });

  await expect(apiService.chatWithWebSearch('latest news')).resolves.toEqual({
    content: 'searched answer',
  });

  expect(loop).toHaveBeenCalledOnce();
});

test('llama.cpp selected model capability is used by web search', async () => {
  const model = {
    id: 'DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    name: 'DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    providerKey: ProviderName.LlamaCpp,
    supportsImage: false,
    capabilities: { toolCalling: ModelCapabilityStatus.Supported },
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({ apiKey: '', baseUrl: 'http://127.0.0.1:8080/v1', apiFormat: 'openai' });
  vi.stubGlobal('window', {
    electron: {
      llamacpp: { showModel: vi.fn().mockResolvedValue({}) },
    },
  });
  const loop = vi
    .spyOn(apiService as any, 'runOpenAIWebSearchLoop')
    .mockResolvedValue({ content: 'searched answer' });

  await expect(apiService.chatWithWebSearch('latest news')).resolves.toEqual({
    content: 'searched answer',
  });

  expect(loop).toHaveBeenCalledOnce();
});

test('llama.cpp runtime vision metadata is not masked by the default image flag', async () => {
  const model = {
    id: 'vision-local',
    name: 'Vision Local',
    providerKey: ProviderName.LlamaCpp,
    supportsImage: false,
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({ apiKey: '', baseUrl: 'http://127.0.0.1:8080/v1', apiFormat: 'openai' });
  vi.stubGlobal('window', {
    electron: {
      llamacpp: {
        showModel: vi.fn().mockResolvedValue({ modalities: { vision: true } }),
      },
    },
  });
  const regularChat = vi
    .spyOn(apiService as any, 'chatWithOpenAICompatible')
    .mockResolvedValue({ content: 'vision answer' });

  await apiService.chat({
    content: 'describe this image',
    images: [
      {
        id: 'image-1',
        name: 'image.png',
        type: 'image/png',
        size: 10,
        dataUrl: 'data:image/png;base64,AAAA',
      },
    ],
  });

  expect(regularChat.mock.calls[0][5]).toBe(true);
});

test('OpenRouter model metadata enables the tool loop only when tools are declared', async () => {
  const model = {
    id: 'vendor/tool-model',
    name: 'OpenRouter Tool Model',
    providerKey: 'openrouter',
    supportsImage: false,
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({
    apiKey: 'openrouter-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai',
  });
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: {
      data: [{ id: model.id, supported_parameters: ['tools'] }],
    },
  });
  vi.stubGlobal('window', { electron: { api: { fetch } } });
  const loop = vi
    .spyOn(apiService as any, 'runOpenAIWebSearchLoop')
    .mockResolvedValue({ content: 'searched answer' });

  await expect(apiService.chatWithWebSearch('latest news')).resolves.toEqual({
    content: 'searched answer',
  });

  expect(fetch).toHaveBeenCalledWith({
    url: 'https://openrouter.ai/api/v1/models',
    method: 'GET',
    headers: { Authorization: 'Bearer openrouter-key' },
  });
  expect(loop).toHaveBeenCalledOnce();
});

test('regular chat uses and caches runtime image capability metadata', async () => {
  const model = {
    id: 'vendor/vision-model',
    name: 'OpenRouter Vision Model',
    providerKey: ProviderName.OpenRouter,
    supportsImage: false,
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({
    apiKey: 'openrouter-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai',
  });
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: {
      data: [
        {
          id: model.id,
          supported_parameters: [],
          architecture: { input_modalities: ['text', 'image'] },
        },
      ],
    },
  });
  vi.stubGlobal('window', { electron: { api: { fetch } } });
  const regularChat = vi
    .spyOn(apiService as any, 'chatWithOpenAICompatible')
    .mockResolvedValue({ content: 'vision answer' });
  const input = {
    content: 'describe this image',
    images: [
      {
        id: 'image-1',
        name: 'image.png',
        type: 'image/png',
        size: 10,
        dataUrl: 'data:image/png;base64,AAAA',
      },
    ],
  };

  await apiService.chat(input);
  await apiService.chat(input);

  expect(fetch).toHaveBeenCalledOnce();
  expect(regularChat).toHaveBeenCalledTimes(2);
  expect(regularChat.mock.calls[0][5]).toBe(true);
});

test('provider hints are resolved from the registry instead of a stale allowlist', () => {
  expect(
    (
      apiService as unknown as { detectProvider: (modelId: string, hint?: string) => string }
    ).detectProvider('qianfan-code-latest', ProviderName.Qianfan),
  ).toBe(ProviderName.Qianfan);
});

test('a catalog model absent from the provider support table does not receive tools', async () => {
  const model = {
    id: 'ernie-4.5-8k',
    name: 'ERNIE 4.5 8K',
    providerKey: ProviderName.Qianfan,
    supportsImage: false,
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({
    apiKey: 'qianfan-key',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiFormat: 'openai',
  });
  const regularChat = vi.spyOn(apiService, 'chat').mockResolvedValue({ content: 'plain answer' });
  const toolLoop = vi.spyOn(apiService as any, 'runOpenAIWebSearchLoop');

  await apiService.chatWithWebSearch('latest news');

  expect(regularChat).toHaveBeenCalledOnce();
  expect(toolLoop).not.toHaveBeenCalled();
});

test('web-search fallback message follows the selected UI language', async () => {
  i18nService.setLanguage('en', { persist: false });
  const model = {
    id: 'custom-unknown-en',
    name: 'Custom Unknown',
    providerKey: 'custom_0',
    supportsImage: false,
  };
  store.dispatch(setAvailableModels([model]));
  store.dispatch(setDefaultSelectedModel(model));
  apiService.setConfig({ apiKey: 'key', baseUrl: 'https://example.test/v1', apiFormat: 'openai' });
  vi.spyOn(apiService, 'chat').mockResolvedValue({ content: 'plain answer' });
  const progress = vi.fn();

  await apiService.chatWithWebSearch('latest news', progress);

  expect(progress).toHaveBeenCalledWith(
    'Tool-calling support for this model is unknown. Switched to regular chat without web search.\n\n',
  );
});

test('OpenAI Responses returns an output for every parallel tool call', async () => {
  const streamResponse = vi
    .spyOn(apiService as any, 'streamOpenAIResponsesResponse')
    .mockResolvedValueOnce({
      output: Array.from({ length: 4 }, (_, index) => ({
        type: 'function_call',
        call_id: `call-${index}`,
        name: 'web_search',
        arguments: JSON.stringify({ query: `query ${index}` }),
      })),
    })
    .mockResolvedValueOnce({ output_text: 'final answer' });
  const webSearch = vi.fn().mockResolvedValue({
    ok: true,
    data: { query: 'test', results: [] },
  });
  vi.stubGlobal('window', { electron: { api: { webSearch } } });

  const result = await (apiService as any).runOpenAIResponsesWebSearchLoop(
    [],
    'system',
    'gpt-test',
    { apiKey: 'model-key', baseUrl: 'https://api.openai.com/v1' },
    undefined,
    'request-1',
  );

  expect(result.content).toBe('final answer');
  expect(webSearch).toHaveBeenCalledTimes(3);
  const secondBody = streamResponse.mock.calls[1][2] as { input: any[] };
  const outputs = secondBody.input.filter(
    (item: { type?: string }) => item.type === 'function_call_output',
  );
  expect(outputs).toHaveLength(4);
  expect(JSON.parse(outputs[3].output)).toEqual({
    error: 'Only three web_search calls are allowed per model turn.',
  });
  expect(streamResponse.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
});

test('OpenAI-compatible Copilot requests retain required headers', async () => {
  const streamResponse = vi.spyOn(apiService as any, 'streamOpenAIChatResponse').mockResolvedValue({
    choices: [{ message: { role: 'assistant', content: 'answer' } }],
  });
  vi.stubGlobal('window', {
    electron: { api: { webSearch: vi.fn() } },
  });

  await (apiService as any).runOpenAIWebSearchLoop(
    [],
    'copilot-model',
    { apiKey: 'copilot-token', baseUrl: 'https://api.githubcopilot.com' },
    'github-copilot',
    undefined,
    'request-2',
  );

  expect(streamResponse.mock.calls[0][1]).toMatchObject({
    'Copilot-Integration-Id': 'vscode-chat',
    'Openai-Intent': 'conversation-panel',
  });
});

test('native OpenAI tool calls are assembled from the cancellable SSE channel', async () => {
  let onData: ((chunk: string) => void) | undefined;
  let onDone: (() => void) | undefined;
  const progress = vi.fn();
  const api = {
    onStreamData: vi.fn((_requestId: string, callback: (chunk: string) => void) => {
      onData = callback;
      return vi.fn();
    }),
    onStreamDone: vi.fn((_requestId: string, callback: () => void) => {
      onDone = callback;
      return vi.fn();
    }),
    onStreamError: vi.fn(() => vi.fn()),
    onStreamAbort: vi.fn(() => vi.fn()),
    stream: vi.fn(async () => {
      queueMicrotask(() => {
        onData?.(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  content: 'Checking ',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: { name: 'web_search', arguments: '{"query":' },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
        );
        onData?.(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  content: 'now',
                  tool_calls: [{ index: 0, function: { arguments: '"latest"}' } }],
                },
              },
            ],
          })}\n\n`,
        );
        onDone?.();
      });
      return { ok: true, status: 200, statusText: 'OK' };
    }),
  };
  vi.stubGlobal('window', { electron: { api } });

  const response = await (apiService as any).streamOpenAIChatResponse(
    'https://example.com/v1/chat/completions',
    {},
    { model: 'test' },
    'request-stream',
    progress,
  );

  expect(progress).toHaveBeenLastCalledWith('Checking now', undefined);
  expect(response.choices[0].message.tool_calls[0]).toMatchObject({
    id: 'call-1',
    function: { name: 'web_search', arguments: '{"query":"latest"}' },
  });
});

test('OpenAI-compatible streams preserve provider reasoning fields for tool replay', async () => {
  let onData: ((chunk: string) => void) | undefined;
  let onDone: (() => void) | undefined;
  const api = {
    onStreamData: vi.fn((_requestId: string, callback: (chunk: string) => void) => {
      onData = callback;
      return vi.fn();
    }),
    onStreamDone: vi.fn((_requestId: string, callback: () => void) => {
      onDone = callback;
      return vi.fn();
    }),
    onStreamError: vi.fn(() => vi.fn()),
    onStreamAbort: vi.fn(() => vi.fn()),
    stream: vi.fn(async () => {
      queueMicrotask(() => {
        onData?.(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  reasoning_content: 'inspect ',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-reasoning',
                      function: { name: 'web_search', arguments: '{"query":"status"}' },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
        );
        onData?.(
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'sources' } }] })}\n\n`,
        );
        onDone?.();
      });
      return { ok: true, status: 200, statusText: 'OK' };
    }),
  };
  vi.stubGlobal('window', { electron: { api } });

  const response = await (apiService as any).streamOpenAIChatResponse(
    'https://example.com/v1/chat/completions',
    {},
    { model: 'deepseek-v4-flash' },
    'request-reasoning',
  );

  expect(response.choices[0].message).toMatchObject({
    content: null,
    reasoning_content: 'inspect sources',
  });
});

test('DeepSeek tool turns replay reasoning and a non-null assistant content field', async () => {
  const streamResponse = vi
    .spyOn(apiService as any, 'streamOpenAIChatResponse')
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            reasoning_content: 'need current sources',
            tool_calls: [
              {
                id: 'call-deepseek',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"latest"}' },
              },
            ],
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'final answer' } }],
    });
  vi.stubGlobal('window', {
    electron: {
      api: { webSearch: vi.fn().mockResolvedValue({ ok: true, data: { results: [] } }) },
    },
  });

  await (apiService as any).runOpenAIWebSearchLoop(
    [],
    'deepseek-v4-flash',
    { apiKey: 'deepseek-key', baseUrl: 'https://api.deepseek.com' },
    ProviderName.DeepSeek,
    undefined,
    'request-deepseek',
  );

  const secondBody = streamResponse.mock.calls[1][2] as { messages: any[] };
  const firstBody = streamResponse.mock.calls[0][2] as Record<string, unknown>;
  expect(firstBody).not.toHaveProperty('tool_choice');
  expect(firstBody).not.toHaveProperty('stream_options');
  expect(secondBody.messages[0]).toMatchObject({
    role: 'assistant',
    content: '',
    reasoning_content: 'need current sources',
  });
});

test('Anthropic streams preserve thinking text and signatures for the next tool turn', async () => {
  let onData: ((chunk: string) => void) | undefined;
  let onDone: (() => void) | undefined;
  const api = {
    onStreamData: vi.fn((_requestId: string, callback: (chunk: string) => void) => {
      onData = callback;
      return vi.fn();
    }),
    onStreamDone: vi.fn((_requestId: string, callback: () => void) => {
      onDone = callback;
      return vi.fn();
    }),
    onStreamError: vi.fn(() => vi.fn()),
    onStreamAbort: vi.fn(() => vi.fn()),
    stream: vi.fn(async () => {
      queueMicrotask(() => {
        const events = [
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'inspect' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'signed' },
          },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'tool-1', name: 'web_search', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"query":"latest"}' },
          },
        ];
        events.forEach(event => onData?.(`data: ${JSON.stringify(event)}\n\n`));
        onDone?.();
      });
      return { ok: true, status: 200, statusText: 'OK' };
    }),
  };
  vi.stubGlobal('window', { electron: { api } });

  const response = await (apiService as any).streamAnthropicResponse(
    'https://example.com/v1/messages',
    {},
    { model: 'claude-sonnet-4-6' },
    'request-anthropic-thinking',
  );

  expect(response.content).toEqual([
    { type: 'thinking', thinking: 'inspect', signature: 'signed' },
    {
      type: 'tool_use',
      id: 'tool-1',
      name: 'web_search',
      input: { query: 'latest' },
    },
  ]);
});

test('an already-aborted signal never starts the provider stream', async () => {
  const abortController = new AbortController();
  abortController.abort();
  const api = {
    onStreamData: vi.fn(() => vi.fn()),
    onStreamDone: vi.fn(() => vi.fn()),
    onStreamError: vi.fn(() => vi.fn()),
    onStreamAbort: vi.fn(() => vi.fn()),
    cancelStream: vi.fn().mockResolvedValue(false),
    stream: vi.fn(),
  };
  vi.stubGlobal('window', { electron: { api } });

  await expect(
    (apiService as any).streamOpenAIChatResponse(
      'https://example.com/v1/chat/completions',
      {},
      { model: 'test' },
      'request-aborted',
      undefined,
      abortController.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });

  expect(api.cancelStream).not.toHaveBeenCalled();
  expect(api.stream).not.toHaveBeenCalled();
});

test('Anthropic receives a tool_result for every parallel call', async () => {
  const streamResponse = vi
    .spyOn(apiService as any, 'streamAnthropicResponse')
    .mockResolvedValueOnce({
      content: Array.from({ length: 4 }, (_, index) => ({
        type: 'tool_use',
        id: `tool-${index}`,
        name: 'web_search',
        input: { query: `query ${index}` },
      })),
    })
    .mockResolvedValueOnce({ content: [{ type: 'text', text: 'done' }] });
  const webSearch = vi.fn().mockResolvedValue({
    ok: true,
    data: { query: 'test', results: [] },
  });
  vi.stubGlobal('window', { electron: { api: { webSearch } } });

  await (apiService as any).runAnthropicWebSearchLoop(
    [],
    'system',
    'claude-test',
    { apiKey: 'key', baseUrl: 'https://api.anthropic.com' },
    undefined,
    'request-anthropic',
  );

  const secondBody = streamResponse.mock.calls[1][2] as { messages: any[] };
  expect(secondBody.messages.at(-1).content).toHaveLength(4);
  expect(JSON.parse(secondBody.messages.at(-1).content[3].content)).toEqual({
    error: 'Only three web_search calls are allowed per model turn.',
  });
});

test('Gemini uses streamGenerateContent and answers every parallel function call', async () => {
  const streamResponse = vi
    .spyOn(apiService as any, 'streamGeminiResponse')
    .mockResolvedValueOnce({
      candidates: [
        {
          content: {
            role: 'model',
            parts: Array.from({ length: 4 }, (_, index) => ({
              functionCall: { name: 'web_search', args: { query: `query ${index}` } },
            })),
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] } }],
    });
  const webSearch = vi.fn().mockResolvedValue({
    ok: true,
    data: { query: 'test', results: [] },
  });
  vi.stubGlobal('window', { electron: { api: { webSearch } } });

  await (apiService as any).runGeminiWebSearchLoop(
    [],
    'system',
    'gemini-test',
    { apiKey: 'key', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    undefined,
    'request-gemini',
  );

  expect(streamResponse.mock.calls[0][0]).toContain(':streamGenerateContent');
  const secondBody = streamResponse.mock.calls[1][2] as { contents: any[] };
  expect(secondBody.contents.at(-1).parts).toHaveLength(4);
  expect(secondBody.contents.at(-1).parts[3].functionResponse.response).toEqual({
    error: 'Only three web_search calls are allowed per model turn.',
  });
});
