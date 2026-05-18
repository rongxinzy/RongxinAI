import { describe, expect, test } from 'vitest';

import { createLlamaCppStreamState, reduceLlamaCppStreamChunk, splitThinkMarkup } from './stream';

describe('llamacpp stream reducer', () => {
  test('accumulates streaming content and final metrics', () => {
    let state = createLlamaCppStreamState();

    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: 'hello ' },
    });
    state = reduceLlamaCppStreamChunk(state, {
      message: { role: 'assistant', content: 'world' },
      done: true,
      eval_count: 12,
      predicted_per_second: 24,
    });

    expect(state.content).toBe('hello world');
    expect(state.phase).toBe('done');
    expect(state.done).toBe(true);
    expect(state.finalChunk?.eval_count).toBe(12);
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

  test('preserves final metrics when a later done chunk has no stats', () => {
    let state = createLlamaCppStreamState();

    state = reduceLlamaCppStreamChunk(state, {
      done: true,
      eval_count: 9,
      predicted_per_second: 17.5,
    });
    state = reduceLlamaCppStreamChunk(state, {
      done: true,
      done_reason: 'stop',
    });

    expect(state.finalChunk?.eval_count).toBe(9);
    expect(state.finalChunk?.predicted_per_second).toBe(17.5);
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
