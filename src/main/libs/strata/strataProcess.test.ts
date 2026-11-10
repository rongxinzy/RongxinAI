import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';
import { watchStrataReady } from './strataProcess';

test('accepts only a complete foreground event for the selected port and ready model', () => {
  const stdout = new PassThrough();
  const onReady = vi.fn();
  const onServing = vi.fn();
  watchStrataReady(stdout, 8096, onReady, onServing);
  const event = {
    schema_version: 1,
    event: 'ready',
    bound_host: '127.0.0.1',
    bound_port: 8096,
    model_id: 'test-model',
    model_state: 'ready',
  };
  stdout.write('Preparing model\n');
  stdout.write('{"schema_version":1,"event":"starting"}\n');
  expect(onServing).toHaveBeenCalledOnce();
  stdout.write(`${JSON.stringify({ ...event, bound_port: 8097 })}\n`);
  stdout.write(`${JSON.stringify({ ...event, model_state: 'unloaded' })}\n`);
  const line = JSON.stringify(event);
  stdout.write(line.slice(0, 20));
  expect(onReady).not.toHaveBeenCalled();
  stdout.write(`${line.slice(20)}\n`);
  stdout.write(`${line}\n`);
  expect(onReady).toHaveBeenCalledExactlyOnceWith('test-model');
  stdout.end();
});
