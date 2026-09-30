import { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';
import { expect, test, vi } from 'vitest';

import { createUncaughtReporter, installStdioErrorGuards } from './stdioErrorGuard';

function fakeStream(): { stream: Writable; fail: (error: unknown) => void } {
  const emitter = new EventEmitter();
  return {
    stream: emitter as unknown as Writable,
    fail: error => emitter.emit('error', error),
  };
}

function brokenPipeError(): NodeJS.ErrnoException {
  const error = new Error('write EPIPE') as NodeJS.ErrnoException;
  error.code = 'EPIPE';
  return error;
}

test('swallows broken pipe failures without notifying the reporter', () => {
  const { stream, fail } = fakeStream();
  const onUnexpectedError = vi.fn();
  installStdioErrorGuards([stream], onUnexpectedError);

  expect(() => fail(brokenPipeError())).not.toThrow();
  expect(onUnexpectedError).not.toHaveBeenCalled();
});

test('forwards other stream errors to the reporter', () => {
  const { stream, fail } = fakeStream();
  const onUnexpectedError = vi.fn();
  installStdioErrorGuards([stream], onUnexpectedError);

  const error = Object.assign(new Error('bad file descriptor'), { code: 'EBADF' });
  fail(error);

  expect(onUnexpectedError).toHaveBeenCalledTimes(1);
  expect(onUnexpectedError).toHaveBeenCalledWith(error);
});

test('tolerates missing streams', () => {
  const onUnexpectedError = vi.fn();

  expect(() => installStdioErrorGuards([undefined], onUnexpectedError)).not.toThrow();
  expect(onUnexpectedError).not.toHaveBeenCalled();
});

test('does not let a throwing reporter escape the stream error handler', () => {
  const { stream, fail } = fakeStream();
  installStdioErrorGuards([stream], () => {
    throw new Error('reporter failed');
  });

  expect(() => fail(Object.assign(new Error('write failure'), { code: 'EBADF' }))).not.toThrow();
});

test('skips a fatal error report raised while another report is running', () => {
  const reported: string[] = [];
  const report = createUncaughtReporter(error => {
    reported.push(String(error));
    if (reported.length === 1) {
      report(new Error('nested'));
    }
  });

  report(new Error('first'));

  expect(reported).toEqual(['Error: first']);
});

test('reports again once the previous report finished', () => {
  const report = createUncaughtReporter(() => {
    throw new Error('reporter failed');
  });

  expect(() => report(new Error('first'))).not.toThrow();
  expect(() => report(new Error('second'))).not.toThrow();
});
