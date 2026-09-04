import { expect, test, vi } from 'vitest';

import { ChatMessagePayload } from '../types/chat';
import { apiService } from './api';
import { ChatChatTransport } from './chatChatTransport';

const ipcMocks = vi.hoisted(() => ({
  sendMessages: vi.fn(),
}));

vi.mock('./api', () => ({
  apiService: {
    chatWithWebSearch: vi.fn(),
    cancelOngoingRequest: vi.fn(),
  },
}));

vi.mock('./ipcChatTransport', () => ({
  IpcChatTransport: class {
    sendMessages = ipcMocks.sendMessages;
  },
}));

async function collectChunks(
  stream: ReadableStream<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const chunks: Record<string, unknown>[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

test('routes the managed ZhiYuan model through the main-process Model Pool bridge', async () => {
  const managedStream = new ReadableStream<Record<string, unknown>>({
    start(controller) {
      controller.close();
    },
  });
  ipcMocks.sendMessages.mockResolvedValue(managedStream);
  const transport = new ChatChatTransport({
    modelId: 'zhiyuan-free',
    modelProviderKey: 'zhiyuan',
  });
  const input = {
    trigger: 'submit-message' as const,
    chatId: 'chat-managed',
    messageId: undefined,
    messages: [{ id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] }],
    abortSignal: undefined,
  };

  await expect(transport.sendMessages(input)).resolves.toBe(managedStream);
  expect(ipcMocks.sendMessages).toHaveBeenCalledWith(input);
  expect(apiService.chatWithWebSearch).not.toHaveBeenCalled();
});

test('emits reasoning-end when reasoning stream finishes before content', async () => {
  let onProgress: ((content: string, reasoning?: string) => void) | undefined;
  let resolveChat: (() => void) | undefined;
  vi.mocked(apiService.chatWithWebSearch).mockImplementation(
    async (
      _message: string | unknown,
      progress?: (content: string, reasoning?: string) => void,
    ) => {
      onProgress = progress;
      return new Promise<{ content: string; reasoning?: string }>(resolve => {
        resolveChat = () => resolve({ content: 'Hello world' });
      });
    },
  );

  const transport = new ChatChatTransport({});
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    abortSignal: undefined,
  });

  onProgress?.('', 'Let me think');
  onProgress?.('', 'Let me think about this');
  onProgress?.('Hello', 'Let me think about this');
  onProgress?.('Hello world', 'Let me think about this');
  resolveChat?.();

  const chunks = await collectChunks(stream);
  const types = chunks.map(c => c.type);

  expect(types).toEqual([
    'reasoning-start',
    'reasoning-delta',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'text-delta',
    'data-session-metrics',
    'text-end',
    'finish',
  ]);
});

test('emits the final result when the provider never reports streaming progress', async () => {
  vi.mocked(apiService.chatWithWebSearch).mockResolvedValue({
    content: 'Buffered answer',
    reasoning: 'Buffered reasoning',
  });

  const transport = new ChatChatTransport({});
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    abortSignal: undefined,
  });

  const chunks = await collectChunks(stream);
  expect(chunks.map(chunk => chunk.type)).toEqual([
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'data-session-metrics',
    'text-end',
    'finish',
  ]);
  expect(chunks).toContainEqual(
    expect.objectContaining({ type: 'reasoning-delta', delta: 'Buffered reasoning' }),
  );
  expect(chunks).toContainEqual(
    expect.objectContaining({ type: 'text-delta', delta: 'Buffered answer' }),
  );
});

test('keeps web search chunks outside reasoning and starts a new reasoning block after search', async () => {
  let onProgress: ((content: string, reasoning?: string) => void) | undefined;
  let onToolEvent:
    | ((event: {
        type: 'start' | 'complete';
        toolCallId: string;
        input?: Record<string, unknown>;
        output?: unknown;
      }) => void)
    | undefined;
  vi.mocked(apiService.chatWithWebSearch).mockImplementation(async (...args: unknown[]) => {
    onProgress = args[1] as typeof onProgress;
    onToolEvent = args[6] as typeof onToolEvent;
    onProgress?.('', 'before search');
    onToolEvent?.({
      type: 'start',
      toolCallId: 'tool-1',
      input: { query: 'latest news' },
    });
    onToolEvent?.({
      type: 'complete',
      toolCallId: 'tool-1',
      output: { results: [] },
    });
    onProgress?.('', 'after search');
    onProgress?.('answer', 'after search');
    return { content: 'answer' };
  });

  const transport = new ChatChatTransport({});
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    abortSignal: undefined,
  });

  const chunks = await collectChunks(stream);
  expect(chunks.map(chunk => chunk.type)).toEqual([
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'tool-input-start',
    'tool-input-available',
    'tool-output-available',
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'data-session-metrics',
    'text-end',
    'finish',
  ]);
  expect(chunks).toContainEqual({
    type: 'tool-input-available',
    toolCallId: 'tool-1',
    toolName: 'web_search',
    input: { query: 'latest news' },
    providerExecuted: true,
  });
});

test('only uses messages before the latest user turn as history', async () => {
  let capturedHistory: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
  vi.mocked(apiService.chatWithWebSearch).mockImplementation(
    async (
      _message: string | unknown,
      _progress?: (content: string, reasoning?: string) => void,
      history?: ChatMessagePayload[],
    ) => {
      capturedHistory = history as Array<{ role: 'user' | 'assistant'; content: string }>;
      return { content: 'ok' };
    },
  );

  const transport = new ChatChatTransport({});
  await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'thinking...' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
    ],
    abortSignal: undefined,
  });

  // Transport itself does not strip thinking messages; CoworkView filters them
  // before calling sendMessages. This test verifies history stops at the last user.
  expect(capturedHistory).toHaveLength(3);
  expect(capturedHistory?.map(m => m.content)).toEqual(['hi', 'thinking...', 'hello']);
});

test('forwards image file parts to the direct chat API', async () => {
  vi.mocked(apiService.chatWithWebSearch).mockResolvedValue({ content: 'ok' });
  const transport = new ChatChatTransport({});
  await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', text: 'What is this?' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,aW1hZ2U=',
            filename: 'screen.png',
          },
        ],
      },
    ],
    abortSignal: undefined,
  });

  const [message] = vi.mocked(apiService.chatWithWebSearch).mock.calls.at(-1) ?? [];
  expect(message).toMatchObject({
    content: 'What is this?',
    images: [
      {
        name: 'screen.png',
        type: 'image/png',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
      },
    ],
  });
});

test('passes the request id and abort signal through the native tool loop', async () => {
  vi.mocked(apiService.chatWithWebSearch).mockImplementation(
    () => new Promise<{ content: string }>(() => {}),
  );
  const abortController = new AbortController();
  const transport = new ChatChatTransport({});
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    abortSignal: abortController.signal,
  });

  const calls = vi.mocked(apiService.chatWithWebSearch).mock.calls;
  const call = calls[calls.length - 1];
  const requestId = call[4];
  expect(typeof requestId).toBe('string');
  expect(call[5]).toBe(abortController.signal);

  abortController.abort();
  await collectChunks(stream);
  expect(apiService.cancelOngoingRequest).toHaveBeenCalledWith(requestId);
});

test('emits context only from verified usage and includes cache tokens in the total', async () => {
  vi.mocked(apiService.chatWithWebSearch).mockResolvedValue({
    content: 'ok',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
    },
  });
  const transport = new ChatChatTransport({ contextWindowTokens: 1_000 });
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    abortSignal: undefined,
  });

  const chunks = await collectChunks(stream);
  expect(chunks).toContainEqual({
    type: 'data-context',
    data: {
      contextWindowTokens: 1_000,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      usedTokens: 170,
    },
  });
});

test('does not emit context without a verified usage result', async () => {
  vi.mocked(apiService.chatWithWebSearch).mockResolvedValue({ content: 'ok' });
  const transport = new ChatChatTransport({ contextWindowTokens: 1_000 });
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    abortSignal: undefined,
  });

  expect((await collectChunks(stream)).some(chunk => chunk.type === 'data-context')).toBe(false);
});
