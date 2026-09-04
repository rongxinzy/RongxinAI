import { afterEach, expect, test, vi } from 'vitest';

import { IpcChatTransport, SseChunkParser } from './ipcChatTransport';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('routes the managed model through the dedicated tokenless renderer IPC', async () => {
  const modelPoolStream = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
  const genericStream = vi.fn();
  const callbacks: { onData?: (chunk: string) => void } = {};
  vi.stubGlobal('window', {
    electron: {
      modelPool: {
        stream: modelPoolStream,
        cancelStream: vi.fn(async () => true),
        onStreamData: vi.fn((_requestId: string, callback: (chunk: string) => void) => {
          callbacks.onData = callback;
          return () => undefined;
        }),
        onStreamDone: vi.fn(() => () => undefined),
        onStreamError: vi.fn(() => () => undefined),
        onStreamAbort: vi.fn(() => () => undefined),
      },
      api: { stream: genericStream },
    },
  });
  const transport = new IpcChatTransport({ provider: 'zhiyuan', model: 'zhiyuan-free' });

  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages: [
      {
        id: 'message-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ],
    abortSignal: undefined,
  });
  await vi.waitFor(() => expect(modelPoolStream).toHaveBeenCalledTimes(1));

  expect(modelPoolStream).toHaveBeenCalledWith({
    requestId: expect.stringMatching(/^ipcchat_chat-1_/u),
    body: {
      model: 'zhiyuan-free',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    },
  });
  expect(genericStream).not.toHaveBeenCalled();

  const reader = stream.getReader();
  callbacks.onData?.('data: {"choices":[{"delta":{"content":"hel');
  callbacks.onData?.('lo"}}]}\n\ndata: [DONE]\n\n');
  await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-start' } });
  await expect(reader.read()).resolves.toMatchObject({
    value: { type: 'text-delta', delta: 'hello' },
  });
  await expect(reader.read()).resolves.toMatchObject({ value: { type: 'finish' } });
});

test('closes reasoning before starting the visible text segment', () => {
  const parser = new SseChunkParser('openai');

  const reasoningChunks = parser.feed({
    choices: [{ delta: { reasoning_content: 'Inspect the request.' } }],
  });
  const textChunks = parser.feed({
    choices: [{ delta: { content: 'Here is the answer.' } }],
  });

  expect(reasoningChunks.map(chunk => chunk.type)).toEqual(['reasoning-start', 'reasoning-delta']);
  expect(textChunks.map(chunk => chunk.type)).toEqual([
    'reasoning-end',
    'text-start',
    'text-delta',
  ]);
});

test('closes an unfinished reasoning segment when the stream completes', () => {
  const parser = new SseChunkParser('openai');
  parser.feed({ choices: [{ delta: { reasoning_content: 'Inspect the request.' } }] });

  expect(parser.flush().map(chunk => chunk.type)).toEqual(['reasoning-end']);
});
