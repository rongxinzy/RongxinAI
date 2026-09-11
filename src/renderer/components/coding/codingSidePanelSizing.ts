import { ARTIFACT_PANEL_CHAT_RESERVE } from '../artifacts/artifactPanelResize';

export const CODING_SIDE_PANEL_MAX_CONTENT_RATIO = 0.6;

/** Keeps a usable conversation column while allowing the coding panel a little
 * more room than the shared artifact preview. */
export function resolveCodingSidePanelMaxWidth(contentWidth: number, minPanelWidth: number): number {
  const chatReserveMaximum = contentWidth - ARTIFACT_PANEL_CHAT_RESERVE;
  const ratioMaximum = contentWidth * CODING_SIDE_PANEL_MAX_CONTENT_RATIO;
  return Math.max(minPanelWidth, Math.min(chatReserveMaximum, ratioMaximum));
}
