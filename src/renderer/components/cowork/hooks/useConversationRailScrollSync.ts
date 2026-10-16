const BOTTOM_PROXIMITY_PX = 24;
const RAIL_ANCHOR_MIN_OFFSET_PX = 96;
const RAIL_ANCHOR_MAX_OFFSET_PX = 160;
const RAIL_ANCHOR_VIEWPORT_RATIO = 0.35;

type RailViewportMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  viewportTop: number;
};

type RailItemRect = {
  railIndex: number;
  top: number;
};

export function resolveActiveRailIndex(
  metrics: RailViewportMetrics,
  items: RailItemRect[],
): number | null {
  if (items.length === 0) return null;

  const lastItem = items[items.length - 1];
  const hiddenBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  if (hiddenBottom <= BOTTOM_PROXIMITY_PX) {
    return lastItem.railIndex;
  }

  const anchorOffset = Math.min(
    RAIL_ANCHOR_MAX_OFFSET_PX,
    Math.max(RAIL_ANCHOR_MIN_OFFSET_PX, metrics.clientHeight * RAIL_ANCHOR_VIEWPORT_RATIO),
  );
  const anchorY = metrics.viewportTop + anchorOffset;
  let activeItem = items[0];

  for (const item of items) {
    if (item.top > anchorY) break;
    activeItem = item;
  }

  return activeItem.railIndex;
}
