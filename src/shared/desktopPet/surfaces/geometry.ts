import { DESKTOP_PET_SIZE } from '../constants';
import { WINDOW_SENSOR_MAX_SURFACES, WindowSurfaceSide } from './constants';
import type {
  NativeWindowFrame,
  SurfaceDisplay,
  SurfacePoint,
  SurfaceRect,
  WindowSurface,
} from './types';

const half = DESKTOP_PET_SIZE / 2;
const foot = DESKTOP_PET_SIZE - 12;
type Interval = readonly [number, number];

export function surfacePoint(surface: WindowSurface, fraction: number): SurfacePoint {
  return {
    x: surface.start.x + (surface.end.x - surface.start.x) * fraction,
    y: surface.start.y + (surface.end.y - surface.start.y) * fraction,
  };
}

/** Clip a closed one-dimensional support line; occlusion also reserves the whole body. */
function subtract(intervals: Interval[], from: number, to: number): Interval[] {
  return intervals.flatMap(([a, b]) => {
    if (to <= a || from >= b) return [[a, b] as Interval];
    const result: Interval[] = [];
    if (from > a) result.push([a, Math.min(from, b)]);
    if (to < b) result.push([Math.max(to, a), b]);
    return result;
  });
}

function toDip(rect: SurfaceRect, display: SurfaceDisplay): SurfaceRect {
  const sx = display.dip.width / display.physical.width;
  const sy = display.dip.height / display.physical.height;
  return {
    x: display.dip.x + (rect.x - display.physical.x) * sx,
    y: display.dip.y + (rect.y - display.physical.y) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

function edges(rect: SurfaceRect) {
  const { x, y, width, height } = rect;
  return [
    { side: WindowSurfaceSide.Top, start: { x, y }, end: { x: x + width, y } },
    { side: WindowSurfaceSide.Left, start: { x, y }, end: { x, y: y + height } },
    {
      side: WindowSurfaceSide.Right,
      start: { x: x + width, y },
      end: { x: x + width, y: y + height },
    },
  ];
}

/** Runs in the native helper, never on Electron's main thread. */
export function visibleWindowSurfaces(
  windows: readonly NativeWindowFrame[],
  displays: readonly SurfaceDisplay[],
): WindowSurface[] {
  const result: WindowSurface[] = [];
  for (const display of displays) {
    const frames = windows.map(window => ({ ...window, rect: toDip(window.rect, display) }));
    const area = display.dip;
    for (let index = 0; index < frames.length; index++) {
      const window = frames[index];
      if (!window.attachable) continue;
      for (const edge of edges(window.rect)) {
        const horizontal = edge.side === WindowSurfaceSide.Top;
        const origin = horizontal ? edge.start.x : edge.start.y;
        const length = horizontal ? edge.end.x - edge.start.x : edge.end.y - edge.start.y;
        if (length <= 0) continue;
        if (
          horizontal
            ? edge.start.y < area.y || edge.start.y > area.y + area.height
            : edge.start.x < area.x || edge.start.x > area.x + area.width
        )
          continue;
        const min = horizontal ? area.x : area.y;
        const max = min + (horizontal ? area.width : area.height);
        let visible: Interval[] = [
          [Math.max(0, (min - origin) / length), Math.min(1, (max - origin) / length)],
        ];
        for (const front of frames.slice(0, index)) {
          const r = front.rect;
          const blocks = horizontal
            ? r.y < edge.start.y + 12 && r.y + r.height > edge.start.y - foot
            : edge.side === WindowSurfaceSide.Left
              ? r.x < edge.start.x + 12 && r.x + r.width > edge.start.x - foot
              : r.x < edge.start.x + foot && r.x + r.width > edge.start.x - 12;
          if (!blocks) continue;
          const begin = (horizontal ? r.x : r.y) - half - 2;
          const end = (horizontal ? r.x + r.width : r.y + r.height) + half + 2;
          visible = subtract(visible, (begin - origin) / length, (end - origin) / length);
          if (!visible.length) break;
        }
        for (const [from, to] of visible) {
          if ((to - from) * length < 8) continue;
          result.push({ ...edge, owner: window.id, display: display.id, from, to });
          if (result.length >= WINDOW_SENSOR_MAX_SURFACES) return result;
        }
      }
    }
  }
  return result;
}

export function fullscreenDisplays(
  foreground: NativeWindowFrame | undefined,
  displays: readonly SurfaceDisplay[],
): string[] {
  if (!foreground) return [];
  const r = foreground.rect;
  return displays
    .filter(
      ({ physical: d }) =>
        r.x <= d.x + 2 &&
        r.y <= d.y + 2 &&
        r.x + r.width >= d.x + d.width - 2 &&
        r.y + r.height >= d.y + d.height - 2,
    )
    .map(display => display.id);
}
