import { BrowserWindow, screen } from 'electron';

import { DESKTOP_PET_SIZE, DesktopPetEffectKind } from '../../shared/desktopPet/constants';
import { DESKTOP_PET_CANVAS_TOP, DESKTOP_PET_WINDOW_HEIGHT } from '../../shared/desktopPet/layout';
import { DesktopPetRoam } from './roam';
import type { DesktopPetEffect } from '../../shared/desktopPet/types';
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
    maxY: Math.max(area.y, area.y + area.height - DESKTOP_PET_WINDOW_HEIGHT),
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
  private roamingEnabled = true;
  private allowRoam = false;
  private readonly roam = new DesktopPetRoam();
  private lastPose: { facing: number; walking: boolean } = { facing: 1, walking: false };

  constructor(
    private readonly window: BrowserWindow,
    private readonly settled: () => void,
    private readonly effect: (effect: DesktopPetEffect) => void = () => {},
    private readonly pose: (pose: { facing: number; walking: boolean }) => void = () => {},
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
    if (value) this.roam.reset(performance.now());
  }

  setRoamingEnabled(value: boolean): void {
    this.roamingEnabled = value;
    if (!value) this.roam.reset(performance.now());
  }

  setAllowRoam(value: boolean): void {
    this.allowRoam = value;
    if (!value) this.roam.reset(performance.now());
  }

  private publishPose(next: { facing: number; walking: boolean }): void {
    if (next.facing === this.lastPose.facing && next.walking === this.lastPose.walking) return;
    this.lastPose = next;
    this.pose(next);
  }

  begin(): void {
    this.flying = undefined;
    this.roam.reset(performance.now());
    this.publishPose({ facing: this.roam.facingDirection, walking: false });
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = this.window.getPosition();
    this.dragging = {
      start: cursor,
      offset: { x: cursor.x - x, y: cursor.y - y },
      at: performance.now(),
    };
    this.trail = [{ ...cursor, t: performance.now() }];
    this.effect({ kind: DesktopPetEffectKind.Drag, active: true });
    this.restart();
  }

  end(): boolean {
    if (!this.dragging) return false;
    const cursor = screen.getCursorScreenPoint();
    const clicked =
      Math.hypot(cursor.x - this.dragging.start.x, cursor.y - this.dragging.start.y) < 5;
    this.sample(cursor, performance.now());
    this.dragging = undefined;
    this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
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
    this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
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
    this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
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

  pause(): void {
    this.dragging = undefined;
    this.flying = undefined;
    this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
    this.settled();
    clearTimeout(this.timer);
    this.window.setIgnoreMouseEvents(true);
    this.ignoring = true;
  }

  resume(): void {
    this.restart();
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
    const [x, y] = this.window.getPosition();
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
        this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
        this.settled();
      }
    } else if (this.flying) {
      // A throw stays on its current display; dragging can move the pet between displays.
      const area = screen.getDisplayMatching(this.window.getBounds()).workArea;
      const next = throwStep(this.flying, (now - this.lastTime) / 1000, petBounds(area));
      // Ground friction also marks a step as bounced; only a reversed normal velocity is an impact.
      const impactSpeed = Math.max(
        next.vx * this.flying.vx < 0 ? Math.abs(this.flying.vx) : 0,
        next.vy * this.flying.vy < 0 ? Math.abs(this.flying.vy) : 0,
      );
      if (next.bounced && impactSpeed > 200 && !this.reducedMotion)
        this.effect({
          kind: DesktopPetEffectKind.Impact,
          strength: Math.min(1, impactSpeed / 1800),
        });
      this.window.setPosition(Math.round(next.x), Math.round(next.y));
      this.flying = next.atRest ? undefined : next;
      if (next.atRest) this.settled();
    } else if (!this.reducedMotion && this.roamingEnabled && this.allowRoam) {
      const area = screen.getDisplayMatching(this.window.getBounds()).workArea;
      const bounds = petBounds(area);
      const moved = this.roam.tick(now, { x, y }, bounds, true);
      if (moved) {
        this.window.setPosition(moved.x, moved.y);
        this.publishPose({ facing: moved.facing, walking: moved.walking });
      } else {
        this.publishPose({ facing: this.roam.facingDirection, walking: false });
      }
    }
    this.lastTime = now;
    const [hitX, hitY] = this.window.getPosition();
    const localX = Math.floor(cursor.x - hitX);
    const localY = Math.floor(cursor.y - hitY - DESKTOP_PET_CANVAS_TOP);
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
    const interval = this.dragging || this.flying || this.roam.isWalking() ? 1000 / 60 : 80;
    this.timer = setTimeout(this.tick, Math.max(1, interval - (performance.now() - now)));
  };
}
