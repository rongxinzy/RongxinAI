import { afterEach, expect, test, vi } from 'vitest';
import { CompanionActivityState as Activity } from '../companion/activity';
import { DESKTOP_PET_TERMINAL_MS, DesktopPetState as Pet } from '../../shared/desktopPet/constants';
import { DesktopPetCompanionStatus } from './companionStatus';

afterEach(() => vi.useRealTimers());

test('chat thinking, completion and interruption defer to every active workbench state', () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const status = new DesktopPetCompanionStatus(changed);
  status.setVisible(true);
  for (const [activity, state] of [
    [Activity.Replying, Pet.Thinking],
    [Activity.Answered, Pet.Completed],
    [Activity.Failed, Pet.Error],
    [Activity.Stopped, Pet.Idle],
  ] as const) {
    status.observe({ petId: 'pet', submissionId: 1, state: activity });
    expect(status.project(Pet.Idle)).toBe(state);
    for (const task of [Pet.Waiting, Pet.Error, Pet.Thinking, Pet.Completed]) {
      expect(status.project(task)).toBe(task);
      expect(status.labelKey(task)).toBeNull();
    }
  }
  expect(changed).toHaveBeenCalledTimes(4);
});

test('terminal expressions expire, and hiding prevents catch-up performances', () => {
  vi.useFakeTimers();
  const status = new DesktopPetCompanionStatus(vi.fn());
  status.setVisible(true);
  status.observe({ petId: 'pet', submissionId: 1, state: Activity.Answered });
  expect(status.labelKey(Pet.Idle)).toBe('companionReplyReady');
  vi.advanceTimersByTime(DESKTOP_PET_TERMINAL_MS);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
  status.observe({ petId: 'pet', submissionId: 2, state: Activity.Failed });
  status.setVisible(false);
  status.setVisible(true);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
  status.observe({ petId: 'pet', submissionId: 3, state: Activity.Replying });
  status.setVisible(false);
  expect(status.project(Pet.Idle)).toBe(Pet.Thinking);
  status.observe({ petId: 'pet', submissionId: 3, state: Activity.Answered });
  status.setVisible(true);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
});

test('a new input cancels the old terminal timer and reset releases its timeout', () => {
  vi.useFakeTimers();
  const changed = vi.fn();
  const status = new DesktopPetCompanionStatus(changed);
  status.setVisible(true);
  status.observe({ petId: 'pet', submissionId: 1, state: Activity.Answered });
  status.observe({ petId: 'pet', submissionId: 2, state: Activity.Replying });
  vi.advanceTimersByTime(DESKTOP_PET_TERMINAL_MS);
  expect(status.project(Pet.Idle)).toBe(Pet.Thinking);
  status.observe({ petId: 'pet', submissionId: 2, state: Activity.Failed });
  status.reset();
  expect(vi.getTimerCount()).toBe(0);
  expect(status.project(Pet.Idle)).toBe(Pet.Idle);
});
