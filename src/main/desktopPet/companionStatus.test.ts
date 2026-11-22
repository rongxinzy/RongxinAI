import { afterEach, expect, test, vi } from 'vitest';
import { CompanionRequestState as Activity } from '../../shared/companion/constants';
import { DESKTOP_PET_TERMINAL_MS, DesktopPetState as Pet } from '../../shared/desktopPet/constants';
import { DesktopPetCompanionStatus } from './companionStatus';

afterEach(() => vi.useRealTimers());

test('chat thinking, completion and interruption defer to every active workbench state', () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const pending = vi.fn<() => boolean>();
  const status = new DesktopPetCompanionStatus(pending, changed);
  for (const [activity, state] of [
    [Activity.Accepted, Pet.Thinking],
    [Activity.Answered, Pet.Completed],
    [Activity.Unanswered, Pet.Error],
    [Activity.Stopped, Pet.Idle],
  ] as const) {
    pending.mockReturnValue(activity === Activity.Accepted);
    status.observe(activity, true);
    expect(status.project(Pet.Idle)).toBe(state);
    for (const task of [Pet.Waiting, Pet.Error, Pet.Thinking, Pet.Completed]) {
      expect(status.project(task)).toBe(task);
      expect(status.labelKey(task, task)).toBeNull();
    }
  }
  expect(changed).toHaveBeenCalledTimes(4);
});

test('terminal expressions expire, and hiding prevents catch-up performances', () => {
  vi.useFakeTimers();
  const pending = vi.fn(() => false);
  const status = new DesktopPetCompanionStatus(pending, vi.fn());
  status.observe(Activity.Answered, true);
  expect(status.labelKey(Pet.Idle, status.project(Pet.Idle))).toBe('companionReplyReady');
  vi.advanceTimersByTime(DESKTOP_PET_TERMINAL_MS);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
  status.observe(Activity.Unanswered, true);
  status.reset();
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
  pending.mockReturnValue(true);
  status.reset();
  expect(status.project(Pet.Idle)).toBe(Pet.Thinking);
  pending.mockReturnValue(false);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
  status.observe(Activity.Answered, false);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
});

test('a new input cancels the old terminal timer and reset releases its timeout', () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const pending = vi.fn(() => false);
  const status = new DesktopPetCompanionStatus(pending, changed);
  status.observe(Activity.Answered, true);
  pending.mockReturnValue(true);
  status.observe(Activity.Accepted, true);
  vi.advanceTimersByTime(DESKTOP_PET_TERMINAL_MS);
  expect(status.project(Pet.Idle)).toBe(Pet.Thinking);
  pending.mockReturnValue(false);
  status.observe(Activity.Unanswered, true);
  status.reset();
  expect(vi.getTimerCount()).toBe(0);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
});
