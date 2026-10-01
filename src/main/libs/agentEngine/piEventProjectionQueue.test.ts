import { expect, test, vi } from 'vitest';
import { PiRunEvent } from '../../../shared/cowork/runState';
import { PiEventProjectionQueue } from './piEventProjectionQueue';
import type { TextWorkerOutput } from '../../workbenchTask/textWorkerOperations';

test('tool transformation preserves event order through finalization', async () => {
  let finish: (value: TextWorkerOutput) => void = () => {};
  const transform = vi.fn(
    () =>
      new Promise<TextWorkerOutput>(resolve => {
        finish = resolve;
      }),
  );
  const consumed: Array<{ type: string; displayResultText?: string }> = [];
  const error = vi.fn();
  const controller = new AbortController();
  const queue = new PiEventProjectionQueue<{
    type: string;
    result?: unknown;
    displayResultText?: string;
  }>(event => consumed.push(event), controller.signal, error, transform);
  queue.push({ type: PiRunEvent.ToolEnd, result: { content: [{ text: 'result' }] } });
  queue.push({ type: PiRunEvent.MessageStart });
  queue.push({ type: PiRunEvent.AgentEnd });
  await vi.waitFor(() => expect(transform).toHaveBeenCalledOnce());
  expect(consumed).toEqual([]);
  finish({ content: 'result', offset: 0, truncated: false });
  await queue.drain();
  expect(consumed.map(event => event.type)).toEqual([
    PiRunEvent.ToolEnd,
    PiRunEvent.MessageStart,
    PiRunEvent.AgentEnd,
  ]);
  expect(consumed[0].displayResultText).toBe('result');
  expect(error).not.toHaveBeenCalled();
});

test('abort prevents delayed worker output from resurrecting a stopped run', async () => {
  let finish: (value: TextWorkerOutput) => void = () => {};
  const transform = () =>
    new Promise<TextWorkerOutput>(resolve => {
      finish = resolve;
    });
  const consume = vi.fn();
  const controller = new AbortController();
  const queue = new PiEventProjectionQueue(consume, controller.signal, vi.fn(), transform);
  queue.push({ type: PiRunEvent.ToolEnd, result: { text: 'x'.repeat(70_000) } });
  await Promise.resolve();
  controller.abort();
  finish({ content: 'late', offset: 0, truncated: false });
  await queue.drain();
  expect(consume).not.toHaveBeenCalled();
});
