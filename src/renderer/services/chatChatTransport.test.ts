import { expect, test, vi } from 'vitest';

import { ChatMessagePayload } from '../types/chat';
import { apiService } from './api';
import { ChatChatTransport } from './chatChatTransport';

vi.mock('./api', () => ({
  apiService: {
    chat: vi.fn(),
    cancelOngoingRequest: vi.fn(),
  },
}));

async function collectChunks(stream: ReadableStream<Record<string, unknown>>): Promise<
  Record<string, unknown>[]
> {
  const reader = stream.getReader();
  const chunks: Record<string, unknown>[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

test('emits reasoning-end when reasoning stream finishes before content', async () => {
  let onProgress: ((content: string, reasoning?: string) => void) | undefined;
  let resolveChat: (() => void) | undefined;
  vi.mocked(apiService.chat).mockImplementation(
    async (_message: string | unknown, progress?: (content: string, reasoning?: string) => void) => {
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
    'text-end',
    'finish',
  ]);
});

test('only uses messages before the latest user turn as history', async () => {
  let capturedHistory: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
  vi.mocked(apiService.chat).mockImplementation(
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
