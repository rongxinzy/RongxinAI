export const ARTIFACT_PANEL_KEYBOARD_RESIZE_STEP = 32;

/** Minimum width the conversation column keeps when the artifact panel is at
 * its drag maximum — the panel must never swallow the chat area. */
export const ARTIFACT_PANEL_CHAT_RESERVE = 360;

export function clampArtifactPanelWidth(value: number, minWidth: number, maxWidth: number): number {
  return Math.min(Math.max(value, minWidth), Math.max(minWidth, maxWidth));
}

/** Panel drag maximum: the content row minus the chat column's reserved
 * minimum, so a fully-dragged panel still leaves a usable conversation. */
export function resolveArtifactPanelMaxWidth(
  contentWidth: number,
  minPanelWidth: number,
): number {
  return Math.max(minPanelWidth, contentWidth - ARTIFACT_PANEL_CHAT_RESERVE);
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
