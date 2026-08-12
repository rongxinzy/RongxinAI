export const ARTIFACT_PANEL_KEYBOARD_RESIZE_STEP = 32;

export function clampArtifactPanelWidth(value: number, minWidth: number, maxWidth: number): number {
  return Math.min(Math.max(value, minWidth), Math.max(minWidth, maxWidth));
}

export function resolveArtifactPanelPointerWidth(
  startWidth: number,
  startClientX: number,
  currentClientX: number,
  minWidth: number,
  maxWidth: number,
): number {
  return clampArtifactPanelWidth(startWidth + startClientX - currentClientX, minWidth, maxWidth);
}

export function resolveArtifactPanelKeyboardWidth(
  currentWidth: number,
  key: string,
  minWidth: number,
  maxWidth: number,
): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampArtifactPanelWidth(
        currentWidth + ARTIFACT_PANEL_KEYBOARD_RESIZE_STEP,
        minWidth,
        maxWidth,
      );
    case 'ArrowRight':
      return clampArtifactPanelWidth(
        currentWidth - ARTIFACT_PANEL_KEYBOARD_RESIZE_STEP,
        minWidth,
        maxWidth,
      );
    case 'Home':
      return minWidth;
    case 'End':
      return Math.max(minWidth, maxWidth);
    default:
      return null;
  }
}

export function isArtifactPanelAtMaximum(width: number, maxWidth: number): boolean {
  return width >= maxWidth - 0.5;
}
