import { EventEmitter } from 'node:events';

import { afterEach, expect, test, vi } from 'vitest';

import { classifyCoworkError } from '../../common/coworkError';
import {
  WorkbenchRunTrigger,
  type WorkbenchRun,
  type WorkbenchTask,
} from '../../shared/workbenchTask';
import type { WorkbenchTaskService } from './taskService';
import { observePreparedRun } from './preparedRunFailure';

afterEach(() => vi.restoreAllMocks());

function fixture(trigger: WorkbenchRunTrigger = WorkbenchRunTrigger.Retry) {
  const task = { id: 'task', sessionId: 'session', activeRunId: 'run' } as WorkbenchTask;
  const run = { id: 'run', taskId: task.id, trigger } as WorkbenchRun;
  const service = {
    repository: { getActiveTaskForSession: vi.fn(() => task) },
    failRun: vi.fn(),
    pauseRun: vi.fn(),
  } as unknown as Pick<WorkbenchTaskService, 'repository' | 'failRun' | 'pauseRun'>;
  const runtime = new EventEmitter();
  const errorListener = vi.fn();
  runtime.on('error', errorListener);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return { task, run, options: { service, runtime }, errorListener };
}

async function settle() {
  await new Promise<void>(resolve => setImmediate(resolve));
}

test('an early retry rejection fails the attempt and emits a visible structured error', async () => {
  const { task, run, options, errorListener } = fixture();
  observePreparedRun(
    async () => {
      throw new Error('Runtime initialization failed');
    },
    task,
    run,
    options,
  );
  await settle();
  expect(options.service.failRun).toHaveBeenCalledWith(task.sessionId, {
    message: 'Runtime initialization failed',
  });
  expect(errorListener).toHaveBeenCalledWith(
    task.sessionId,
    classifyCoworkError('Runtime initialization failed'),
  );
  expect(options.runtime.listenerCount('error')).toBe(1);
});

test('a resume initialization rejection pauses the attempt', async () => {
  const { task, run, options } = fixture(WorkbenchRunTrigger.Resume);
  observePreparedRun(
    async () => {
      throw new Error('Resume failed');
    },
    task,
    run,
    options,
  );
  await settle();
  expect(options.service.pauseRun).toHaveBeenCalledWith(task.sessionId, 'Resume failed');
  expect(options.service.failRun).not.toHaveBeenCalled();
});

test('does not duplicate an error already reported by the runtime', async () => {
  const { task, run, options, errorListener } = fixture();
  observePreparedRun(
    async () => {
      options.runtime.emit('error', task.sessionId, classifyCoworkError('Provider failed'));
      throw new Error('Provider failed');
    },
    task,
    run,
    options,
  );
  await settle();
  expect(options.service.failRun).toHaveBeenCalledOnce();
  expect(errorListener).toHaveBeenCalledOnce();
});

test('a superseded or cancelled attempt cannot fail the new task or emit a stale error', async () => {
  const { task, run, options, errorListener } = fixture();
  let reject!: (error: Error) => void;
  observePreparedRun(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
    task,
    run,
    options,
  );
  await settle();
  task.activeRunId = 'replacement-run';
  reject(new Error('Old run failed'));
  await settle();
  expect(options.service.failRun).not.toHaveBeenCalled();
  expect(errorListener).not.toHaveBeenCalled();
  expect(options.runtime.listenerCount('error')).toBe(1);
});

test('dispatch returns immediately and removes the observer after success', async () => {
  const { task, run, options } = fixture();
  let resolve!: () => void;
  expect(
    observePreparedRun(
      () =>
        new Promise<void>(done => {
          resolve = done;
        }),
      task,
      run,
      options,
    ),
  ).toBeUndefined();
  await settle();
  expect(options.runtime.listenerCount('error')).toBe(2);
  resolve();
  await settle();
  expect(options.runtime.listenerCount('error')).toBe(1);
  expect(options.service.failRun).not.toHaveBeenCalled();
});

test('still reports the runtime error and releases the observer if failure persistence throws', async () => {
  const { task, run, options, errorListener } = fixture();
  vi.mocked(options.service.failRun).mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  observePreparedRun(
    async () => {
      throw new Error('Runtime initialization failed');
    },
    task,
    run,
    options,
  );
  await settle();
  expect(errorListener).toHaveBeenCalledWith(
    task.sessionId,
    classifyCoworkError('Runtime initialization failed'),
  );
  expect(options.runtime.listenerCount('error')).toBe(1);
});
