import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { debounce } from './debounce';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('debounce only invokes the latest call after waitMs', () => {
  const fn = vi.fn();
  const debounced = debounce(fn, 100);

  debounced('a');
  debounced('b');
  debounced('c');
  expect(fn).not.toHaveBeenCalled();

  vi.advanceTimersByTime(99);
  expect(fn).not.toHaveBeenCalled();

  vi.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledWith('c');
});

test('debounce.cancel drops the pending call', () => {
  const fn = vi.fn();
  const debounced = debounce(fn, 50);

  debounced();
  debounced.cancel();
  vi.advanceTimersByTime(100);

  expect(fn).not.toHaveBeenCalled();
});

test('debounce.flush runs the pending call immediately', () => {
  const fn = vi.fn();
  const debounced = debounce(fn, 200);

  debounced('flush-me');
  debounced.flush();

  expect(fn).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledWith('flush-me');

  vi.advanceTimersByTime(200);
  expect(fn).toHaveBeenCalledTimes(1);
});
