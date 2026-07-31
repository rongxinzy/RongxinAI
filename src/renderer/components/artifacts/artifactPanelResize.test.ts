import { describe, expect, test } from 'vitest';

import {
  clampArtifactPanelWidth,
  isArtifactPanelAtMaximum,
  resolveArtifactPanelKeyboardWidth,
  resolveArtifactPanelPointerWidth,
} from './artifactPanelResize';

describe('artifact panel resize', () => {
  test('tracks horizontal pointer movement and clamps only at the available edges', () => {
    expect(resolveArtifactPanelPointerWidth(560, 900, 700, 180, 1400)).toBe(760);
    expect(resolveArtifactPanelPointerWidth(560, 900, 1400, 180, 1400)).toBe(180);
    expect(resolveArtifactPanelPointerWidth(560, 900, -200, 180, 1400)).toBe(1400);
  });

  test('supports precise keyboard resizing and both boundaries', () => {
    expect(resolveArtifactPanelKeyboardWidth(560, 'ArrowLeft', 180, 1400)).toBe(592);
    expect(resolveArtifactPanelKeyboardWidth(560, 'ArrowRight', 180, 1400)).toBe(528);
    expect(resolveArtifactPanelKeyboardWidth(560, 'Home', 180, 1400)).toBe(180);
    expect(resolveArtifactPanelKeyboardWidth(560, 'End', 180, 1400)).toBe(1400);
    expect(resolveArtifactPanelKeyboardWidth(560, 'Enter', 180, 1400)).toBeNull();
  });

  test('uses the live container maximum instead of a fixed pixel ceiling', () => {
    expect(clampArtifactPanelWidth(1536, 180, 1720)).toBe(1536);
    expect(isArtifactPanelAtMaximum(1719.75, 1720)).toBe(true);
    expect(isArtifactPanelAtMaximum(1719, 1720)).toBe(false);
  });
});
