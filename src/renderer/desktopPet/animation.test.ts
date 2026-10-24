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

test('playAction mixes in the action pose and a spring bounce', () => {
  const animation = new DesktopPetAnimation();
  animation.sample(0);
  animation.playAction(DesktopPetPlayableAction.Happy, 0);
  expect(animation.weights(450)[DesktopPetSprite[DesktopPetState.Greeting]]).toBeGreaterThan(0.5);
  expect(animation.sample(50).scaleY).toBeLessThan(1);
  expect(animation.sample(2_000).offsetY).toBe(0);
});

test('reduced motion settles directly to the latest pose and clears a landing impulse', () => {
  const animation = new DesktopPetAnimation();
  animation.sample(0);
  animation.setState(DesktopPetState.Greeting, 20);
  animation.impact(1);
  animation.settle(40);
  expect(animation.weights(40)).toEqual([0, 0, 0, 0, 0, 1]);
  expect(animation.sample(40).transitioning).toBe(false);
  expect(animation.sample(40).scaleY).toBeCloseTo(1 + Math.sin(40 / 1400) * 0.012);
  expect(Number.isFinite(animation.sample(60_000).scaleY)).toBe(true);
});
