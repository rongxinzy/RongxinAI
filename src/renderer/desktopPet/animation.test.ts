import { test, expect } from 'vitest';

import {
  DesktopPetPlayableAction,
  DesktopPetSprite,
  DesktopPetState,
} from '../../shared/desktopPet/constants';
import { DesktopPetAnimation } from './animation';

test('an interrupted expression transition starts from the visible mixture without a jump', () => {
  const animation = new DesktopPetAnimation();
  animation.setState(DesktopPetState.Thinking, 0);
  expect(animation.weights(0)).toEqual([1, 0, 0, 0, 0, 0]);
  const midway = animation.weights(80);
  expect(midway).toEqual([0.5, 0.5, 0, 0, 0, 0]);
  animation.setState(DesktopPetState.Waiting, 80);
  expect(animation.weights(80)).toEqual(midway);
  expect(animation.weights(160).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
  expect(animation.weights(240)).toEqual([0, 0, 1, 0, 0, 0]);
});

test('spring response is independent of refresh rate and preserves shape at release', () => {
  const simulate = (hz: number) => {
    const animation = new DesktopPetAnimation();
    animation.sample(0);
    animation.setDragging(true);
    for (let frame = 1; frame <= hz / 2; frame++) animation.sample((frame * 1000) / hz);
    const before = animation.sample(500).scaleY;
    animation.setDragging(false);
    expect(animation.sample(500).scaleY).toBeCloseTo(before, 10);
    animation.impact(0.8);
    for (let frame = 1; frame <= hz / 2; frame++) animation.sample(500 + (frame * 1000) / hz);
    return animation.sample(1000).scaleY;
  };
  expect(simulate(60)).toBeCloseTo(simulate(120), 10);
});

test('happy performance runs through anticipation, leap and recovery over seven seconds', () => {
  const animation = new DesktopPetAnimation();
  animation.configure(12);
  animation.sample(0);
  animation.playAction(DesktopPetPlayableAction.Happy, 0);
  expect(animation.sample(500).scaleY).toBeLessThan(1);
  expect(animation.sample(1000).offsetY).toBe(-16);
  expect(animation.weights(1000)[11]).toBe(1);
  expect(animation.sample(3500).sequence).toBe(DesktopPetPlayableAction.Happy);
  expect(animation.sample(7000).offsetY).toBe(0);
  expect(animation.weights(7000)[DesktopPetSprite[DesktopPetState.Idle]]).toBe(1);
});

test('reduced motion settles directly to the latest pose and clears a landing impulse', () => {
  const animation = new DesktopPetAnimation();
  animation.sample(0);
  animation.setState(DesktopPetState.Greeting, 20);
  animation.impact(1);
  animation.setReducedMotion(true, 40);
  expect(animation.weights(40)).toEqual([0, 0, 0, 0, 0, 1]);
  expect(animation.sample(40).transitioning).toBe(false);
  expect(animation.sample(40).scaleY).toBe(1);
  expect(Number.isFinite(animation.sample(60_000).scaleY)).toBe(true);
});

test('task state preempts a performance without a position jump and cannot be overwritten', () => {
  for (const state of [DesktopPetState.Error, DesktopPetState.Waiting, DesktopPetState.Thinking]) {
    const animation = new DesktopPetAnimation();
    animation.configure(12);
    animation.playAction(DesktopPetPlayableAction.Happy, 0);
    const before = animation.sample(1000);
    animation.setState(state, 1000);
    expect(animation.sample(1000).offsetY).toBe(before.offsetY);
    animation.playAction(DesktopPetPlayableAction.Happy, 1001);
    const after = animation.sample(1160);
    expect(after.sequence).toBeNull();
    expect(after.offsetY).toBe(0);
    expect(after.weights[DesktopPetSprite[state]]).toBe(1);
  }
});

test('drag, walking, hidden window and reduced motion cancel playback without catch-up', () => {
  const animation = new DesktopPetAnimation();
  animation.configure(12);
  animation.playAction(DesktopPetPlayableAction.Peek, 0);
  animation.sample(1000);
  animation.setDragging(true);
  expect(animation.sample(1200).sequence).toBeNull();
  animation.setDragging(false);
  animation.playAction(DesktopPetPlayableAction.Peek, 1300);
  animation.setPose(-1, true);
  expect(animation.sample(1500).sequence).toBeNull();
  animation.setPose(1, false);
  animation.playAction(DesktopPetPlayableAction.Happy, 2000);
  animation.setPaused(true, 3000);
  animation.setPaused(false, 60_000);
  expect(animation.sample(60_000).sequence).toBeNull();
  animation.setReducedMotion(true, 60_001);
  animation.playAction(DesktopPetPlayableAction.Happy, 60_002);
  const a = animation.sample(60_003);
  const b = animation.sample(70_000);
  expect([a.scaleY, a.offsetY, a.rotate]).toEqual([1, 0, 0]);
  expect(b.weights).toEqual(a.weights);
});

test('pointer press squishes scaleY gently and springs back on release', () => {
  const animation = new DesktopPetAnimation();
  animation.setContinuousMedia(true, 0);
  expect(animation.sample(0).scaleY).toBe(1);
  animation.setPressed(true);
  const squished = animation.sample(80).scaleY;
  expect(squished).toBeLessThan(0.99);
  animation.setPressed(false);
  expect(animation.sample(600).scaleY).toBeCloseTo(1, 3);
});

test('continuous media can rest between decoded frames while interactions still need rendering', () => {
  const animation = new DesktopPetAnimation();
  animation.setContinuousMedia(true, 0);
  animation.sample(0);
  expect(animation.needsFrame(16)).toBe(false);
  animation.setPressed(true);
  expect(animation.needsFrame(16)).toBe(true);
  animation.setPressed(false);
  animation.settle(600);
  expect(animation.needsFrame(600)).toBe(false);
  animation.setContinuousMedia(false, 600);
  expect(animation.needsFrame(600)).toBe(true);
  animation.setReducedMotion(true, 600);
  expect(animation.needsFrame(600)).toBe(false);
});
