import { beforeEach, describe, expect, it, vi } from 'vitest';

const sleepState = vi.hoisted(() => ({ started: false }));

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('electron')>('electron');
  return {
    ...actual,
    powerSaveBlocker: {
      start: vi.fn(() => {
        sleepState.started = true;
        return 42;
      }),
      isStarted: vi.fn(() => sleepState.started),
      stop: vi.fn(() => {
        sleepState.started = false;
      }),
    },
  };
});

import {
  clearActiveRunSleepBlockers,
  setActiveRunSleepBlocker,
  setPreventSleepBlockerEnabled,
} from './runtimeServices';
import { lifecycleRuntime } from './lifecycleRuntimeState';

describe('runtimeServices sleep blocker', () => {
  beforeEach(() => {
    sleepState.started = false;
    lifecycleRuntime.preventSleepBlockerId = null;
    clearActiveRunSleepBlockers();
  });

  it('keeps prevent-app-suspension active while any cowork run is running even if manual setting is off', () => {
    setActiveRunSleepBlocker('session-1', true);
    expect(sleepState.started).toBe(true);
    expect(lifecycleRuntime.preventSleepBlockerId).toBe(42);

    setActiveRunSleepBlocker('session-2', true);
    setActiveRunSleepBlocker('session-1', false);
    expect(sleepState.started).toBe(true);

    setActiveRunSleepBlocker('session-2', false);
    expect(sleepState.started).toBe(false);
    expect(lifecycleRuntime.preventSleepBlockerId).toBeNull();
  });

  it('preserves manual prevent-sleep preference across active run completion', () => {
    setPreventSleepBlockerEnabled(true);
    setActiveRunSleepBlocker('session-1', true);
    setActiveRunSleepBlocker('session-1', false);
    expect(sleepState.started).toBe(true);

    setPreventSleepBlockerEnabled(false);
    expect(sleepState.started).toBe(false);
  });
});
