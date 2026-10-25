import type { WindowSurfaceSide } from './constants';

export interface SurfacePoint {
  x: number;
  y: number;
}
export interface SurfaceRect extends SurfacePoint {
  width: number;
  height: number;
}
export interface SurfaceDisplay {
  id: string;
  physical: SurfaceRect;
  dip: SurfaceRect;
  workArea: SurfaceRect;
}
/** Physical pixels, in front-to-back Z order. No titles, content, paths or process names. */
export interface NativeWindowFrame {
  id: string;
  rect: SurfaceRect;
  attachable: boolean;
}
export interface WindowSurface {
  owner: string;
  display: string;
  side: WindowSurfaceSide;
  /** Full owner edge in this display's DIP space; visible fractions remain stable on moves. */
  start: SurfacePoint;
  end: SurfacePoint;
  from: number;
  to: number;
}
export interface WindowSurfaceSnapshot {
  revision: number;
  sequence: number;
  capturedAt: number;
  timing: { queueMs: number; runMs: number };
  surfaces: WindowSurface[];
  fullscreenDisplays: string[];
}
