const SESSION_TITLE_MARQUEE_MIN_DURATION_MS = 900;
const SESSION_TITLE_MARQUEE_SPEED_PX_PER_SECOND = 48;
const SESSION_TITLE_OVERFLOW_TOLERANCE_PX = 1;

export interface SessionTitleMarqueeMetrics {
  distancePx: number;
  durationMs: number;
}

export const getSessionTitleMarqueeMetrics = (
  viewportWidth: number,
  contentWidth: number,
): SessionTitleMarqueeMetrics | null => {
  const distancePx = Math.max(0, contentWidth - viewportWidth);
  if (distancePx <= SESSION_TITLE_OVERFLOW_TOLERANCE_PX) return null;

  return {
    distancePx,
    durationMs: Math.max(
      SESSION_TITLE_MARQUEE_MIN_DURATION_MS,
      Math.round((distancePx / SESSION_TITLE_MARQUEE_SPEED_PX_PER_SECOND) * 1000),
    ),
  };
};
