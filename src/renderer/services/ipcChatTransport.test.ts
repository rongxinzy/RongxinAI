import { expect, test } from 'vitest';

import { SseChunkParser } from './ipcChatTransport';

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
