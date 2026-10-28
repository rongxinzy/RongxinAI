import { BrowserWindow, screen } from 'electron';

import {
  DESKTOP_PET_DRAG_THRESHOLD,
  DESKTOP_PET_SIZE,
  DesktopPetEffectKind,
  DesktopPetPlayableAction,
} from '../../shared/desktopPet/constants';
import { DESKTOP_PET_CANVAS_TOP, DESKTOP_PET_WINDOW_HEIGHT } from '../../shared/desktopPet/layout';
import { PetOrientation } from '../../shared/desktopPet/surfaces/constants';
import { WindowSurfaceWalker } from '../../shared/desktopPet/surfaces/walker';
import type { WindowSurfaceSnapshot } from '../../shared/desktopPet/surfaces/types';
import type { DesktopPetEffect, DesktopPetPose } from '../../shared/desktopPet/types';
import { DesktopPetRoam } from './roam';
import {
  estimateReleaseVelocity,
  impactStrength,
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
  private dragging:
    | { start: Electron.Point; offset: Electron.Point; at: number; moved: boolean }
    | undefined;
  private trail: DragSample[] = [];
  private flying: ThrowState | undefined;
  private lastTime = performance.now();
  private mask = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  private ignoring = true;
  private reducedMotion = false;
  private roamingEnabled = true;
  private allowRoam = false;
  private readonly roam = new DesktopPetRoam();
  private readonly surfaces = new WindowSurfaceWalker();
  private hopping = false;
  private paused = false;
  private droppedSupport = false;
  private supported = false;
  private lastPose: DesktopPetPose = {
    facing: 1,
    walking: false,
    orientation: PetOrientation.Upright,
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly settled: () => void,
    private readonly effect: (effect: DesktopPetEffect) => void = () => {},
    private readonly pose: (pose: DesktopPetPose) => void = () => {},
    /** Lifted only while the pet stands on another window, never permanently on top. */
    private readonly support: (active: boolean) => void = () => {},
  ) {
    window.setIgnoreMouseEvents(true);
    this.tick();
  }

  setMask(mask: Uint8Array): void {
    this.mask = new Uint8Array(mask);
  }

  setWindowSnapshot(snapshot: WindowSurfaceSnapshot | null): void {
    this.surfaces.setSnapshot(snapshot, performance.now());
    if (snapshot && !this.paused && !this.reducedMotion && this.surfaces.active) this.restart();
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value && this.flying) {
      this.flying = undefined;
      this.settled();
    }
    if (value) {
      this.surfaces.reset(performance.now());
      this.rest();
    }
  }

  setRoamingEnabled(value: boolean): void {
    this.roamingEnabled = value;
    if (!value) this.releaseSupport();
  }

  setAllowRoam(value: boolean): void {
    this.allowRoam = value;
    if (!value) this.rest();
  }

  rest(): void {
    const now = performance.now();
    this.roam.reset(now);
    this.surfaces.rest(now);
    this.publishPose({
      facing: this.lastPose.facing,
      walking: false,
      orientation: this.surfaces.currentOrientation,
    });
  }

  private publishPose(next: DesktopPetPose): void {
    if (
      next.facing === this.lastPose.facing &&
      next.walking === this.lastPose.walking &&
      next.orientation === this.lastPose.orientation
    )
      return;
    this.lastPose = {
      facing: next.facing,
      walking: next.walking,
      orientation: next.orientation,
    };
    this.pose(this.lastPose);
  }

  /** Roaming off means the pet belongs on the desktop, not on someone else's window. */
  private releaseSupport(): void {
    if (!this.surfaces.active || this.window.isDestroyed()) {
      this.rest();
      return;
    }
    const [x, y] = this.window.getPosition();
    const now = performance.now();
    this.surfaces.startDrop({ x, y }, now);
    this.hopping = false;
    this.restart();
  }

  begin(): void {
    this.droppedSupport = false;
    this.flying = undefined;
    const now = performance.now();
    this.roam.reset(now);
    this.surfaces.rest(now);
    this.publishPose({
      facing: this.roam.facingDirection,
      walking: false,
      orientation: this.surfaces.currentOrientation,
    });
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = this.window.getPosition();
    this.dragging = {
      start: cursor,
      offset: { x: cursor.x - x, y: cursor.y - y },
      at: performance.now(),
      moved: false,
    };
    this.trail = [{ ...cursor, t: performance.now() }];
    this.restart();
  }

  end(cancelled = false): boolean {
    if (!this.dragging) return false;
    const now = performance.now();
    const cursor = screen.getCursorScreenPoint();
    if (!cancelled) this.moveDrag(cursor, now);
    const clicked = !cancelled && !this.dragging.moved;
    this.sample(cursor, now);
    this.dragging = undefined;
    this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
    const velocity =
      this.reducedMotion || clicked || cancelled ? null : estimateReleaseVelocity(this.trail, now);
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
    this.droppedSupport = false;
    this.surfaces.reset(performance.now());
    this.rest();
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
    this.droppedSupport = false;
    this.surfaces.reset(performance.now());
    this.rest();
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
    this.setSupport(false);
    clearTimeout(this.timer);
  }

  private setSupport(active: boolean): void {
    if (active === this.supported) return;
    this.supported = active;
    this.support(active);
  }

  pause(): void {
    this.paused = true;
    this.droppedSupport ||= this.surfaces.active;
    this.surfaces.reset(performance.now());
    this.hopping = false;
    this.setSupport(false);
    this.rest();
    this.dragging = undefined;
    this.flying = undefined;
    this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
    this.settled();
    clearTimeout(this.timer);
    this.window.setIgnoreMouseEvents(true);
    this.ignoring = true;
  }

  resume(): void {
    this.paused = false;
    if (this.droppedSupport && !this.reducedMotion && !this.window.isDestroyed()) {
      const [x, y] = this.window.getPosition();
      this.surfaces.startDrop({ x, y }, performance.now());
      this.droppedSupport = false;
    }
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

  private moveDrag(cursor: Electron.Point, now: number): void {
    const drag = this.dragging;
    if (!drag) return;
    this.sample(cursor, now);
    if (!drag.moved) {
      if (Math.hypot(cursor.x - drag.start.x, cursor.y - drag.start.y) < DESKTOP_PET_DRAG_THRESHOLD)
        return;
      drag.moved = true;
      this.surfaces.reset(now);
      this.hopping = false;
      this.publishPose({
        facing: this.lastPose.facing,
        walking: false,
        orientation: PetOrientation.Upright,
      });
      this.effect({ kind: DesktopPetEffectKind.Drag, active: true });
    }
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const point = clampPetPosition(
      { x: cursor.x - drag.offset.x, y: cursor.y - drag.offset.y },
      petBounds(area),
    );
    this.window.setPosition(point.x, point.y);
  }

  private tick = (): void => {
    if (this.window.isDestroyed()) return;
    const now = performance.now();
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = this.window.getPosition();
    let position = { x, y };
    if (this.dragging) {
      this.moveDrag(cursor, now);
      const [draggedX, draggedY] = this.window.getPosition();
      position = { x: draggedX, y: draggedY };
      if (now - this.dragging.at > 60_000) {
        this.dragging = undefined;
        this.effect({ kind: DesktopPetEffectKind.Drag, active: false });
        this.settled();
      }
    } else if (this.flying) {
      // A throw stays on its current display; dragging can move the pet between displays.
      const area = screen.getDisplayMatching({
        ...position,
        width: DESKTOP_PET_SIZE,
        height: DESKTOP_PET_WINDOW_HEIGHT,
      }).workArea;
      const next = throwStep(this.flying, (now - this.lastTime) / 1000, petBounds(area));
      // Ground friction also marks a step as bounced; only a reversed normal velocity is an impact.
      const impactSpeed = Math.max(
        next.vx * this.flying.vx < 0 ? Math.abs(this.flying.vx) : 0,
        next.vy * this.flying.vy < 0 ? Math.abs(this.flying.vy) : 0,
      );
      const strength = impactStrength(impactSpeed);
      if (next.bounced && strength > 0 && !this.reducedMotion)
        this.effect({
          kind: DesktopPetEffectKind.Impact,
          strength,
        });
      const nextPosition = { x: Math.round(next.x), y: Math.round(next.y) };
      if (nextPosition.x !== position.x || nextPosition.y !== position.y)
        this.window.setPosition(nextPosition.x, nextPosition.y);
      position = nextPosition;
      this.flying = next.atRest ? undefined : next;
      if (next.atRest) this.settled();
    } else if (!this.reducedMotion) {
      const display = screen.getDisplayMatching(this.window.getBounds());
      const surface = this.surfaces.tick(
        now,
        position,
        String(display.id),
        display.workArea,
        this.roamingEnabled && this.allowRoam,
      );
      if (surface) {
        const nextPosition = clampPetPosition(surface, petBounds(display.workArea));
        if (nextPosition.x !== position.x || nextPosition.y !== position.y)
          this.window.setPosition(nextPosition.x, nextPosition.y);
        position = nextPosition;
        this.publishPose(surface);
        if (surface.hopping && !this.hopping)
          this.effect({
            kind: DesktopPetEffectKind.Action,
            action: DesktopPetPlayableAction.Flutter,
          });
        if (surface.landed) this.effect({ kind: DesktopPetEffectKind.Impact, strength: 0.25 });
        this.hopping = Boolean(surface.hopping);
      } else if (this.roamingEnabled && this.allowRoam) {
        this.hopping = false;
        const bounds = petBounds(display.workArea);
        const elapsedMs = Math.min(100, Math.max(0, now - this.lastTime));
        const moved = this.roam.tick(now, position, bounds, true, elapsedMs);
        if (moved) {
          const nextPosition = { x: Math.round(moved.x), y: Math.round(moved.y) };
          if (nextPosition.x !== position.x || nextPosition.y !== position.y)
            this.window.setPosition(nextPosition.x, nextPosition.y);
          position = nextPosition;
          this.publishPose({
            facing: moved.facing,
            walking: moved.walking,
            orientation: PetOrientation.Upright,
          });
        } else {
          this.publishPose({
            facing: this.roam.facingDirection,
            walking: false,
            orientation: PetOrientation.Upright,
          });
        }
      }
    }
    this.setSupport(this.surfaces.active);
    this.lastTime = now;
    const localX = Math.floor(cursor.x - position.x);
    const localY = Math.floor(cursor.y - position.y - DESKTOP_PET_CANVAS_TOP);
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
    const interval =
      this.dragging || this.flying || this.roam.isWalking() || this.surfaces.moving
        ? 1000 / 60
        : 80;
    this.timer = setTimeout(this.tick, Math.max(1, interval - (performance.now() - now)));
  };
}
