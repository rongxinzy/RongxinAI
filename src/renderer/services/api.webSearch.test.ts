import { afterEach, expect, test, vi } from 'vitest';

import { apiService } from './api';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('OpenAI Responses returns an output for every parallel tool call', async () => {
  const streamResponse = vi
    .spyOn(apiService as any, 'streamOpenAIResponsesResponse')
    .mockResolvedValueOnce(
      {
        output: Array.from({ length: 4 }, (_, index) => ({
          type: 'function_call',
          call_id: `call-${index}`,
          name: 'web_search',
          arguments: JSON.stringify({ query: `query ${index}` }),
        })),
      },
    )
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
  const streamResponse = vi
    .spyOn(apiService as any, 'streamOpenAIChatResponse')
    .mockResolvedValue(
      {
      choices: [{ message: { role: 'assistant', content: 'answer' } }],
      },
    );
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
