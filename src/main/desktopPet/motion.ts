import { BrowserWindow, screen } from 'electron';

import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import {
  estimateReleaseVelocity,
  throwStep,
  trimTrail,
  type DragSample,
  type ThrowBounds,
  type ThrowState,
} from '../../shared/desktopPet/physics';

export function petBounds(area: Electron.Rectangle): ThrowBounds {
  return {
    minX: area.x,
    minY: area.y,
    maxX: Math.max(area.x, area.x + area.width - DESKTOP_PET_SIZE),
    maxY: Math.max(area.y, area.y + area.height - DESKTOP_PET_SIZE),
  };
}

export function clampPetPosition(point: Electron.Point, bounds: ThrowBounds): Electron.Point {
  return {
    x: Math.round(Math.max(bounds.minX, Math.min(point.x, bounds.maxX))),
    y: Math.round(Math.max(bounds.minY, Math.min(point.y, bounds.maxY))),
  };
}

/** Native pointer coordinates stay in DIP, including on mixed-DPI displays. */
export class DesktopPetMotion {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dragging: { start: Electron.Point; offset: Electron.Point; at: number } | undefined;
  private trail: DragSample[] = [];
  private flying: ThrowState | undefined;
  private lastTime = performance.now();
  private mask = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  private ignoring = true;
  private reducedMotion = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly settled: () => void,
  ) {
    window.setIgnoreMouseEvents(true);
    this.tick();
  }

  setMask(mask: Uint8Array): void {
    this.mask = new Uint8Array(mask);
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value && this.flying) {
      this.flying = undefined;
      this.settled();
    }
  }

  begin(): void {
    this.flying = undefined;
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = this.window.getPosition();
    this.dragging = {
      start: cursor,
      offset: { x: cursor.x - x, y: cursor.y - y },
      at: performance.now(),
    };
    this.trail = [{ ...cursor, t: performance.now() }];
    this.restart();
  }

  end(): boolean {
    if (!this.dragging) return false;
    const cursor = screen.getCursorScreenPoint();
    const clicked =
      Math.hypot(cursor.x - this.dragging.start.x, cursor.y - this.dragging.start.y) < 5;
    this.sample(cursor, performance.now());
    this.dragging = undefined;
    const velocity =
      this.reducedMotion || clicked ? null : estimateReleaseVelocity(this.trail, performance.now());
    if (velocity) {
      const [x, y] = this.window.getPosition();
      this.flying = { x, y, ...velocity };
    } else {
      this.settled();
    }
    this.restart();
    return clicked;
  }

  reset(): void {
    this.dragging = undefined;
    this.flying = undefined;
    const bounds = petBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
    this.window.setPosition(
      Math.max(bounds.minX, bounds.maxX - 24),
      Math.max(bounds.minY, bounds.maxY - 24),
    );
    this.settled();
  }

  ensureVisible(): void {
    this.dragging = undefined;
    this.flying = undefined;
    const bounds = this.window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const point = clampPetPosition(bounds, petBounds(area));
    this.window.setPosition(point.x, point.y);
    this.settled();
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private restart(): void {
    clearTimeout(this.timer);
    this.lastTime = performance.now();
    this.tick();
  }

  private sample(cursor: Electron.Point, now: number): void {
    const last = this.trail[this.trail.length - 1];
    // A stationary hold must expire the release velocity instead of reusing an old flick.
    if (!last || last.x !== cursor.x || last.y !== cursor.y) {
      this.trail = trimTrail([...this.trail, { ...cursor, t: now }], now);
    }
  }

  private tick = (): void => {
    if (this.window.isDestroyed()) return;
    const now = performance.now();
    const cursor = screen.getCursorScreenPoint();
    if (this.dragging) {
      this.sample(cursor, now);
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const point = clampPetPosition(
        {
          x: cursor.x - this.dragging.offset.x,
          y: cursor.y - this.dragging.offset.y,
        },
        petBounds(area),
      );
      this.window.setPosition(point.x, point.y);
      if (now - this.dragging.at > 60_000) {
        this.dragging = undefined;
        this.settled();
      }
    } else if (this.flying) {
      // A throw stays on its current display; dragging can move the pet between displays.
      const area = screen.getDisplayMatching(this.window.getBounds()).workArea;
      const next = throwStep(this.flying, (now - this.lastTime) / 1000, petBounds(area));
      this.window.setPosition(Math.round(next.x), Math.round(next.y));
      this.flying = next.atRest ? undefined : next;
      if (next.atRest) this.settled();
    }
    this.lastTime = now;
    const [x, y] = this.window.getPosition();
    const localX = Math.floor(cursor.x - x);
    const localY = Math.floor(cursor.y - y);
    const hit =
      localX >= 0 &&
      localX < DESKTOP_PET_SIZE &&
      localY >= 0 &&
      localY < DESKTOP_PET_SIZE &&
      this.mask[localY * DESKTOP_PET_SIZE + localX] > 32;
    const ignore = !this.dragging && !hit;
    if (ignore !== this.ignoring) {
      this.window.setIgnoreMouseEvents(ignore);
      this.ignoring = ignore;
    }
    this.timer = setTimeout(this.tick, this.dragging || this.flying ? 16 : 80);
  };
}
