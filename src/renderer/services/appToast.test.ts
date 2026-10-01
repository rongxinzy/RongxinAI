// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { showAppError, showAppToast } from './appToast';

const captureToasts = () => {
  const seen: string[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message: string } | string>).detail;
    seen.push(typeof detail === 'string' ? detail : detail.message);
  };
  window.addEventListener('app:showToast', listener);
  return { seen, stop: () => window.removeEventListener('app:showToast', listener) };
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('shared prompt dedupe', () => {
  test('does not repeat the same sentence while it is still on screen', () => {
    const toasts = captureToasts();
    try {
      // A periodic path (git refresh, sidebar reload, window focus) must not
      // re-announce a failure the user has already seen.
      showAppToast('同一个错误', { isError: true });
      showAppToast('同一个错误', { isError: true });
      expect(toasts.seen).toHaveLength(1);

      vi.advanceTimersByTime(6_000);
      showAppToast('同一个错误', { isError: true });
      expect(toasts.seen).toHaveLength(2);

      showAppToast('另一个错误', { isError: true });
      expect(toasts.seen).toHaveLength(3);
    } finally {
      toasts.stop();
    }
  });

  test('ignores an empty message', () => {
    const toasts = captureToasts();
    try {
      showAppToast('   ');
      expect(toasts.seen).toEqual([]);
    } finally {
      toasts.stop();
    }
  });

  test('error helper keeps the classified text', () => {
    const toasts = captureToasts();
    try {
      showAppError('git push failed with exit code 128.');
      expect(toasts.seen).toEqual(['操作失败：git push failed with exit code 128']);
    } finally {
      toasts.stop();
    }
  });
});
