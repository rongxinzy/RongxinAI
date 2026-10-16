// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';

import {
  resolveStableSessionKey,
  setPersistentToggleNamespace,
  usePersistentToggle,
} from './usePersistentToggle';

beforeEach(() => {
  setPersistentToggleNamespace('test-session-1');
});

test('initializes with default value when not previously recorded', () => {
  const { result } = renderHook(() => usePersistentToggle('toggle-1', false));
  expect(result.current[0]).toBe(false);
});

test('persists initial active default so remounting with false retains expanded state', () => {
  // First mount: streaming thought is active (defaultValue = true)
  const first = renderHook(
    ({ defaultValue }: { defaultValue: boolean }) =>
      usePersistentToggle('reasoning-block-1', defaultValue),
    { initialProps: { defaultValue: true } },
  );
  expect(first.result.current[0]).toBe(true);
  first.unmount();

  // Second mount (e.g. after virtualization scroll when streaming has ended)
  const remounted = renderHook(
    ({ defaultValue }: { defaultValue: boolean }) =>
      usePersistentToggle('reasoning-block-1', defaultValue),
    { initialProps: { defaultValue: false } },
  );
  expect(remounted.result.current[0]).toBe(true);
});

test('promotes an initially empty streaming block when the first token arrives', () => {
  const hook = renderHook(
    ({ defaultValue }: { defaultValue: boolean }) =>
      usePersistentToggle('reasoning-empty-first', defaultValue),
    { initialProps: { defaultValue: false } },
  );
  expect(hook.result.current[0]).toBe(false);

  // First token arrives -> defaultValue transitions to true
  hook.rerender({ defaultValue: true });
  expect(hook.result.current[0]).toBe(true);
  hook.unmount();

  // Remount after streaming ends -> stays expanded
  const remounted = renderHook(() => usePersistentToggle('reasoning-empty-first', false));
  expect(remounted.result.current[0]).toBe(true);
});

test('explicit user toggle overrides initial state and persists across remount', () => {
  const first = renderHook(() => usePersistentToggle('reasoning-block-2', true));
  expect(first.result.current[0]).toBe(true);

  // User manually collapses it
  act(() => {
    first.result.current[1](false);
  });
  expect(first.result.current[0]).toBe(false);
  first.unmount();

  // Remount with true or false
  const remounted = renderHook(() => usePersistentToggle('reasoning-block-2', true));
  expect(remounted.result.current[0]).toBe(false);
});

test('namespaces isolate persisted states across different sessions', () => {
  setPersistentToggleNamespace('session-a');
  const sessionA = renderHook(() => usePersistentToggle('block-x', true));
  expect(sessionA.result.current[0]).toBe(true);
  sessionA.unmount();

  setPersistentToggleNamespace('session-b');
  const sessionB = renderHook(() => usePersistentToggle('block-x', false));
  expect(sessionB.result.current[0]).toBe(false);
});

test('preserves stable session key and toggle memory when a temp-* session is promoted to a real id', () => {
  setPersistentToggleNamespace('temp-1001');
  expect(resolveStableSessionKey('temp-1001')).toBe('temp-1001');
  const tempHook = renderHook(() => usePersistentToggle('reasoning-promoted', true));
  expect(tempHook.result.current[0]).toBe(true);
  tempHook.unmount();

  // Backend resolves real session id
  setPersistentToggleNamespace('real-session-1001');
  expect(resolveStableSessionKey('real-session-1001')).toBe('temp-1001');
  const realHook = renderHook(() => usePersistentToggle('reasoning-promoted', false));
  expect(realHook.result.current[0]).toBe(true);
});
