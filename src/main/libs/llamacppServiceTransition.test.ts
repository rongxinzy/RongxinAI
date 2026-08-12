import { expect, test, vi } from 'vitest';

import { applyLlamaCppServiceTransition } from './llamacppServiceTransition';

test('restarts the service without restoring the previous model and refreshes bindings once', async () => {
  const events: string[] = [];
  const start = vi.fn(async () => {
    events.push('start');
    return { status: 'running' as const };
  });
  const stop = vi.fn(async () => {
    events.push('stop');
    return { status: 'stopped' as const };
  });
  const clearLastLoadedModel = vi.fn(() => events.push('clear'));
  const applyConfig = vi.fn(() => events.push('config'));
  const refreshBindings = vi.fn(async () => events.push('refresh'));
  const setBindingRefreshSuppressed = vi.fn((value: boolean) => events.push(`suppress:${value}`));

  const result = await applyLlamaCppServiceTransition({
    wasRunning: true,
    stop,
    start,
    applyConfig,
    clearLastLoadedModel,
    refreshBindings,
    setBindingRefreshSuppressed,
  });

  expect(result).toEqual({ status: 'running' });
  expect(events).toEqual([
    'suppress:true',
    'clear',
    'stop',
    'config',
    'start',
    'suppress:false',
    'refresh',
  ]);
  expect(clearLastLoadedModel).toHaveBeenCalledOnce();
  expect(refreshBindings).toHaveBeenCalledOnce();
});

test('applies a directory change while stopped without starting the service', async () => {
  const start = vi.fn();
  const stop = vi.fn();
  const applyConfig = vi.fn();
  const clearLastLoadedModel = vi.fn();
  const refreshBindings = vi.fn(async () => undefined);
  const setBindingRefreshSuppressed = vi.fn();

  const result = await applyLlamaCppServiceTransition({
    wasRunning: false,
    stop,
    start,
    applyConfig,
    clearLastLoadedModel,
    refreshBindings,
    setBindingRefreshSuppressed,
  });

  expect(result).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  expect(applyConfig).toHaveBeenCalledOnce();
  expect(clearLastLoadedModel).toHaveBeenCalledOnce();
  expect(refreshBindings).toHaveBeenCalledOnce();
});
