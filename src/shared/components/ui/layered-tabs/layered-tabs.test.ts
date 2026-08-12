import { describe, expect, test } from 'vitest';

import { getLayeredTabMetrics } from './layered-tabs';

describe('getLayeredTabMetrics', () => {
  test('raises the active tab above its neighbors', () => {
    expect(getLayeredTabMetrics(0, 0, 3)).toMatchObject({
      isActive: true,
      zIndex: 4,
      height: 40,
      width: '100%',
      textScale: 1,
    });
    expect(getLayeredTabMetrics(1, 0, 3).zIndex).toBeGreaterThan(
      getLayeredTabMetrics(2, 0, 3).zIndex,
    );
  });

  test('uses equal depth for tabs on either side of a centered active tab', () => {
    const left = getLayeredTabMetrics(0, 1, 3);
    const right = getLayeredTabMetrics(2, 1, 3);

    expect(left.depth).toBe(1);
    expect(right.depth).toBe(1);
    expect(left.height).toBe(32);
    expect(right.height).toBe(32);
  });

  test('compresses tabs beyond the second layer', () => {
    expect(getLayeredTabMetrics(3, 0, 4)).toMatchObject({
      depth: 2,
      isThirdLayer: true,
      height: 27.5,
      width: '86%',
      textScale: 0.75,
    });
  });
});
