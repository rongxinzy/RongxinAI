import { expect, test } from 'vitest';
import { COMPANION_BUBBLE_ART_WIDTH, CompanionBubbleSide } from '../../shared/companion/bubble';
import { companionBubblePlacement } from './bubblePlacement';

test('the bubble sits above the character canvas and points at its center', () => {
  const result = companionBubblePlacement(
    { x: 700, y: 700, width: 192, height: 232 },
    { x: 0, y: 0, width: 1440, height: 1000 },
  );
  expect(result.placement.side).toBe(CompanionBubbleSide.Above);
  expect(result.bounds.y + result.bounds.height + 8).toBe(740);
  expect(result.bounds.x + result.placement.anchorX).toBe(796);
});

test('screen-top placement flips below and negative-coordinate edge placement stays inside the display', () => {
  const area = { x: -1440, y: -100, width: 1440, height: 900 };
  for (const x of [-1440, -200]) {
    const result = companionBubblePlacement({ x, y: -80, width: 192, height: 232 }, area);
    expect(result.placement.side).toBe(CompanionBubbleSide.Below);
    expect(result.bounds.x).toBeGreaterThanOrEqual(area.x + 8);
    expect(result.bounds.x + result.bounds.width).toBeLessThanOrEqual(-8);
    expect(result.bounds.y).toBe(160);
    expect(result.placement.anchorX).toBeGreaterThanOrEqual(24);
    expect(result.placement.anchorX).toBeLessThanOrEqual(result.bounds.width - 24);
  }
});

test('the artwork tail follows the pet center at narrow display widths above and below', () => {
  for (const width of [480, 448, 320]) {
    for (const y of [20, 700]) {
      const anchor = { x: 104, y, width: 192, height: 232 };
      const result = companionBubblePlacement(anchor, {
        x: 0,
        y: 0,
        width: width + 16,
        height: 1000,
      });
      const renderedTailX =
        result.bounds.x +
        (result.placement.anchorX / COMPANION_BUBBLE_ART_WIDTH) * result.bounds.width;
      expect(renderedTailX).toBeCloseTo(anchor.x + anchor.width / 2, 5);
      expect(result.placement.side).toBe(
        y === 20 ? CompanionBubbleSide.Below : CompanionBubbleSide.Above,
      );
    }
  }
});
