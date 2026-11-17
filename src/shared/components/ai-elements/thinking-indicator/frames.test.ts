import { expect, test } from 'vitest';
import { resolvePreset } from 'thinking-orbs';

import { THINKING_ORB_PRESETS, THINKING_ORB_STATE } from './constants';
import { settledThinkingFrame } from './frames';

test('settles both indicator sizes into the same complete sphere at every stopping time', () => {
  for (const size of Object.values(THINKING_ORB_PRESETS)) {
    const { opts } = resolvePreset(THINKING_ORB_STATE, size);
    const frame = settledThinkingFrame(size, 0, opts);
    expect(settledThinkingFrame(size, 19.7, opts)).toEqual(frame);
    expect(settledThinkingFrame(size, 185.25, opts)).toEqual(frame);
    expect(frame.lines).toHaveLength(0);
    expect(frame.dots.length).toBeGreaterThan(40);
    expect(frame.dots.every(dot => dot.a === 1)).toBe(true);
    const width =
      Math.max(...frame.dots.map(dot => dot.x)) - Math.min(...frame.dots.map(dot => dot.x));
    const height =
      Math.max(...frame.dots.map(dot => dot.y)) - Math.min(...frame.dots.map(dot => dot.y));
    expect(width / height).toBeGreaterThan(0.9);
    expect(width / height).toBeLessThan(1.1);
  }
});
