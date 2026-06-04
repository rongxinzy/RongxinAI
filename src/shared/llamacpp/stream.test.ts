import { describe, expect, test } from 'vitest';

import { createLlamaCppStreamState, reduceLlamaCppStreamChunk, splitThinkMarkup } from './stream';

describe('llamacpp stream reducer', () => {
  test('accumulates streaming content', () => {
    let state = createLlamaCppStreamState();

    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: 'hello ' },
    });
    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: 'world' },
      done: true,
    });

    expect(state.content).toBe('hello world');
    expect(state.phase).toBe('done');
    expect(state.done).toBe(true);
  });

  test('separates official thinking from final content', () => {
    let state = createLlamaCppStreamState();

    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: '', thinking: 'thinking...' },
    });
    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: 'answer' },
    });

    expect(state.thinking).toBe('thinking...');
    expect(state.content).toBe('answer');
    expect(state.phase).toBe('responding');
  });

  test('moves from waiting to thinking to responding to done', () => {
    let state = createLlamaCppStreamState();

    expect(state.phase).toBe('waiting');

    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: '' },
    });
    expect(state.phase).toBe('waiting');

    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: '', thinking: 'working' },
    });
    expect(state.phase).toBe('thinking');

    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: 'answer' },
    });
    expect(state.phase).toBe('responding');

    state = reduceLlamaCppStreamChunk(state, {
      done: true,
    });
    expect(state.phase).toBe('done');
    expect(state.content).toBe('answer');
    expect(state.thinking).toBe('working');
  });

  test('splits legacy think markup out of content', () => {
    expect(splitThinkMarkup('<think>hidden</think>visible')).toEqual({
      thinking: 'hidden',
      content: 'visible',
    });
  });

  test('splits open think markup while streaming', () => {
    let state = createLlamaCppStreamState();

    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: '<think>hidden' },
    });

    expect(state.thinking).toBe('hidden');
    expect(state.content).toBe('');
    expect(state.phase).toBe('thinking');
  });

  test('surfaces stream error chunks', () => {
    const state = reduceLlamaCppStreamChunk(createLlamaCppStreamState(), {
      error: 'model not found',
      done: true,
    });

    expect(state.phase).toBe('error');
    expect(state.error).toBe('model not found');
    expect(state.done).toBe(true);
  });
});
