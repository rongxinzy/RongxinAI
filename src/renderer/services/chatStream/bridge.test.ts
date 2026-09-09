import { expect, test, vi } from 'vitest';
import { streamOverBridge, type StreamBridge } from './bridge';
import { ChatFinishReason, ChatStreamEvent } from './constants';

function setup(signal?: AbortSignal) {
  let data = (_chunk: string) => {};
  let done = () => {};
  let error = (_error: string | { message: string }) => {};
  const remove = vi.fn();
  const bridge: StreamBridge = {
    start: vi.fn(async () => ({ ok: true, status: 200 })),
    cancel: vi.fn(async () => undefined),
    onData: (_id, callback) => {
      data = callback;
      return remove;
    },
    onDone: (_id, callback) => {
      done = callback;
      return remove;
    },
    onError: (_id, callback) => {
      error = callback;
      return remove;
    },
    onAbort: () => remove,
  };
  const parser = { feed: vi.fn(() => []), flush: vi.fn(() => []) };
  const stream = streamOverBridge('request', signal, bridge, parser);
  return {
    stream,
    bridge,
    remove,
    parser,
    data: (chunk: string) => data(chunk),
    done: () => done(),
    error: () => error('late error'),
  };
}
test('EOF without terminal marker is an error, not a successful completion', async () => {
  const state = setup();
  state.data('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  state.done();
  const reader = state.stream.getReader();
  expect((await reader.read()).value?.type).toBe(ChatStreamEvent.Error);
  expect((await reader.read()).done).toBe(true);
  expect(state.parser.flush).not.toHaveBeenCalled();
  expect(state.bridge.cancel).toHaveBeenCalledOnce();
});
test('length termination remains distinct and never flushes incomplete tool arguments', async () => {
  const state = setup();
  state.data('data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');
  const reader = state.stream.getReader();
  expect((await reader.read()).value?.type).toBe(ChatStreamEvent.Error);
  expect((await reader.read()).value).toEqual({
    type: ChatStreamEvent.Finish,
    finishReason: ChatFinishReason.Length,
  });
  expect(state.parser.flush).not.toHaveBeenCalled();
});
test('normal completion followed by late callbacks closes once', async () => {
  const state = setup();
  state.data('data:[DONE]\r\n\r\n');
  expect(() => {
    state.done();
    state.error();
    state.data('data: garbage\n');
  }).not.toThrow();
  const reader = state.stream.getReader();
  expect((await reader.read()).value?.type).toBe(ChatStreamEvent.Finish);
  expect((await reader.read()).done).toBe(true);
  expect(state.remove).toHaveBeenCalledTimes(4);
});
test('already-aborted signals do not start; consumer cancellation detaches all listeners', async () => {
  const controller = new AbortController();
  controller.abort();
  const early = setup(controller.signal);
  expect(early.bridge.start).not.toHaveBeenCalled();
  expect((await early.stream.getReader().read()).value?.type).toBe(ChatStreamEvent.Abort);
  const state = setup();
  await state.stream.cancel();
  expect(state.bridge.cancel).toHaveBeenCalledOnce();
  expect(state.remove).toHaveBeenCalledTimes(4);
  expect(() => {
    state.data('data: [DONE]\n');
    state.done();
    state.error();
  }).not.toThrow();
});
