import { DESKTOP_PET_WINDOW_HEIGHT } from '../layout';
import { PetOrientation, WINDOW_SENSOR_STALE_MS, WindowSurfaceSide } from './constants';
import { surfacePoint } from './geometry';
import {
  surfaceContactArea,
  surfaceFoot,
  surfaceOrientation,
  surfacePositionFits,
  surfaceWindowPosition,
} from './placement';
import type { SurfacePoint, SurfaceRect, WindowSurface, WindowSurfaceSnapshot } from './types';

interface Attachment {
  owner: string;
  side: WindowSurfaceSide;
  fraction: number;
  direction: number;
  restUntil: number;
  distance: number;
}
interface Hop {
  from: SurfacePoint;
  to: SurfacePoint;
  target: Attachment;
  at: number;
}
interface Fall {
  foot: SurfacePoint;
  velocity: number;
}
export interface SurfaceMovement extends SurfacePoint {
  orientation: PetOrientation;
  walking: boolean;
  facing: number;
  hopping?: boolean;
  landed?: boolean;
}
const SPEED = 42;
const MAX_HOP = 160;
const HOP_MS = 650;
const GRAVITY = 980;
const nextRest = (now: number) => now + 8000 + Math.random() * 12000;
const edgeLength = (edge: WindowSurface) =>
  Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y);

/** Native positions are derived from a continuous contact point, never rounded back into physics. */
export class WindowSurfaceWalker {
  private surfaces: readonly WindowSurface[] = [];
  private receivedAt = -Infinity;
  private attachment: Attachment | null = null;
  private hop: Hop | null = null;
  private fall: Fall | null = null;
  private previous = 0;
  private exploreAt = 0;
  private facing = 1;
  private orientation: PetOrientation = PetOrientation.Upright;
  private walking = false;

  setSnapshot(snapshot: WindowSurfaceSnapshot | null, now: number): void {
    this.surfaces = snapshot?.surfaces ?? [];
    this.receivedAt = snapshot ? now : -Infinity;
  }
  get active(): boolean {
    return Boolean(this.attachment || this.hop || this.fall);
  }
  get moving(): boolean {
    return Boolean(this.hop || this.fall || this.walking);
  }
  get currentOrientation(): PetOrientation {
    return this.orientation;
  }
  reset(now: number): void {
    this.attachment = null;
    this.hop = null;
    this.fall = null;
    this.orientation = PetOrientation.Upright;
    this.walking = false;
    this.previous = now;
    this.exploreAt = nextRest(now);
  }
  rest(now: number): void {
    if (this.attachment) this.attachment.restUntil = nextRest(now);
    this.exploreAt = nextRest(now);
  }
  startDrop(position: SurfacePoint, now: number): void {
    const foot = surfaceFoot(position, this.orientation);
    this.reset(now);
    this.fall = { foot, velocity: 0 };
  }

  private pose(foot: SurfacePoint, walking: boolean): SurfaceMovement {
    this.walking = walking;
    return {
      ...surfaceWindowPosition(foot, this.orientation),
      orientation: this.orientation,
      facing: this.facing,
      walking,
    };
  }
  private edge(attachment: Attachment, display: string): WindowSurface | undefined {
    return this.surfaces.find(
      edge =>
        edge.display === display &&
        edge.owner === attachment.owner &&
        edge.side === attachment.side &&
        attachment.fraction >= edge.from - 0.00001 &&
        attachment.fraction <= edge.to + 0.00001,
    );
  }
  private attach(edge: WindowSurface, fraction: number, now: number): void {
    this.attachment = {
      owner: edge.owner,
      side: edge.side,
      fraction,
      direction: edge.side === WindowSurfaceSide.Top ? this.facing : -1,
      restUntil: nextRest(now),
      distance: 0,
    };
    this.orientation = surfaceOrientation(edge.side);
  }

  /**
   * A wall next to the taskbar exposes its lowest stretch where the rotated body would leave the
   * work area; climb from the closest reachable spot instead of skipping the window entirely.
   */
  private reachable(edge: WindowSurface, area: SurfaceRect): [number, number] | null {
    const contact = surfaceContactArea(surfaceOrientation(edge.side), area);
    const horizontal = edge.side === WindowSurfaceSide.Top;
    const fixed = horizontal ? edge.start.y : edge.start.x;
    const fixedMin = horizontal ? contact.y : contact.x;
    if (fixed < fixedMin || fixed > fixedMin + (horizontal ? contact.height : contact.width))
      return null;
    const min = horizontal ? contact.x : contact.y;
    const max = min + (horizontal ? contact.width : contact.height);
    const origin = horizontal ? edge.start.x : edge.start.y;
    const length = horizontal ? edge.end.x - edge.start.x : edge.end.y - edge.start.y;
    const first = (min - origin) / length;
    const last = (max - origin) / length;
    const low = Math.max(edge.from, Math.min(first, last));
    const high = Math.min(edge.to, Math.max(first, last));
    return low <= high ? [low, high] : null;
  }

  private candidate(foot: SurfacePoint, display: string, area: SurfaceRect, owner?: string) {
    let best:
      | { edge: WindowSurface; fraction: number; foot: SurfacePoint; distance: number }
      | undefined;
    for (const edge of this.surfaces) {
      if (edge.display !== display || edge.owner === owner) continue;
      const reachable = this.reachable(edge, area);
      if (!reachable) continue;
      const dx = edge.end.x - edge.start.x,
        dy = edge.end.y - edge.start.y;
      const fraction = Math.max(
        reachable[0],
        Math.min(
          reachable[1],
          ((foot.x - edge.start.x) * dx + (foot.y - edge.start.y) * dy) / (dx * dx + dy * dy),
        ),
      );
      const point = surfacePoint(edge, fraction);
      const distance = Math.hypot(point.x - foot.x, point.y - foot.y);
      if (distance > MAX_HOP || (best && distance >= best.distance)) continue;
      if (!surfacePositionFits(surfaceWindowPosition(point, surfaceOrientation(edge.side)), area))
        continue;
      best = { edge, fraction, foot: point, distance };
    }
    return best;
  }

  private startHop(
    foot: SurfacePoint,
    display: string,
    area: SurfaceRect,
    now: number,
    owner?: string,
  ): boolean {
    const target = this.candidate(foot, display, area, owner);
    if (!target || target.distance < 8) return false;
    for (const fraction of Array.from({ length: 17 }, (_, index) => index / 16)) {
      const sample = {
        x: foot.x + (target.foot.x - foot.x) * fraction,
        y: foot.y + (target.foot.y - foot.y) * fraction - Math.sin(fraction * Math.PI) * 48,
      };
      if (!surfacePositionFits(surfaceWindowPosition(sample, PetOrientation.Upright), area))
        return false;
    }
    this.hop = {
      from: foot,
      to: target.foot,
      at: now,
      target: {
        owner: target.edge.owner,
        side: target.edge.side,
        fraction: target.fraction,
        direction: target.edge.side === WindowSurfaceSide.Top ? this.facing : -1,
        restUntil: nextRest(now),
        distance: 0,
      },
    };
    this.attachment = null;
    this.orientation = PetOrientation.Upright;
    return true;
  }

  tick(
    now: number,
    position: SurfacePoint,
    display: string,
    area: SurfaceRect,
    allow: boolean,
  ): SurfaceMovement | null {
    const dt = Math.max(0, Math.min(0.05, (now - this.previous) / 1000));
    this.previous = now;
    if (now - this.receivedAt > WINDOW_SENSOR_STALE_MS) this.surfaces = [];
    if (this.hop) {
      const hop = this.hop;
      const target = this.edge(hop.target, display);
      if (!target) {
        this.hop = null;
        this.fall = { foot: surfaceFoot(position, this.orientation), velocity: 0 };
      } else {
        // Do not chase a moving window by teleporting; abort a hop whose landing point moved.
        const landing = surfacePoint(target, hop.target.fraction);
        if (Math.hypot(landing.x - hop.to.x, landing.y - hop.to.y) > 8) {
          this.hop = null;
          this.fall = { foot: surfaceFoot(position, this.orientation), velocity: 0 };
        } else {
          const t = Math.max(0, Math.min(1, (now - hop.at) / HOP_MS));
          if (t >= 1) {
            this.hop = null;
            this.attachment = hop.target;
            this.orientation = surfaceOrientation(target.side);
            return { ...this.pose(landing, false), landed: true };
          }
          return {
            ...this.pose(
              {
                x: hop.from.x + (hop.to.x - hop.from.x) * t,
                y: hop.from.y + (hop.to.y - hop.from.y) * t - Math.sin(Math.PI * t) * 48,
              },
              false,
            ),
            hopping: true,
          };
        }
      }
    }
    if (this.attachment) {
      const attachment = this.attachment;
      const edge = this.edge(attachment, display);
      if (edge) {
        const contact = surfacePoint(edge, attachment.fraction);
        const native = surfaceWindowPosition(contact, this.orientation);
        if (surfacePositionFits(native, area)) {
          if (!allow || now < attachment.restUntil) return this.pose(contact, false);
          const distance = SPEED * dt;
          const next = attachment.fraction + (attachment.direction * distance) / edgeLength(edge);
          if (next >= edge.from && next <= edge.to) {
            attachment.fraction = next;
            attachment.distance += distance;
            this.facing =
              edge.side === WindowSurfaceSide.Top
                ? attachment.direction
                : edge.side === WindowSurfaceSide.Left
                  ? -attachment.direction
                  : attachment.direction;
            const moved = surfacePoint(edge, next);
            if (surfacePositionFits(surfaceWindowPosition(moved, this.orientation), area)) {
              if (attachment.distance >= 160) {
                attachment.restUntil = nextRest(now);
                attachment.distance = 0;
              }
              return this.pose(moved, now >= attachment.restUntil);
            }
          }
          const endpoint = attachment.direction > 0 ? edge.to : edge.from;
          attachment.fraction = Math.max(edge.from, Math.min(edge.to, attachment.fraction));
          const corner = surfacePoint(edge, endpoint);
          if (endpoint <= 0.00001 || endpoint >= 0.99999) {
            const side =
              edge.side === WindowSurfaceSide.Top
                ? attachment.direction < 0
                  ? WindowSurfaceSide.Left
                  : WindowSurfaceSide.Right
                : WindowSurfaceSide.Top;
            const fraction =
              side === WindowSurfaceSide.Top ? (edge.side === WindowSurfaceSide.Left ? 0 : 1) : 0;
            const adjacent = this.surfaces.find(
              candidate =>
                candidate.owner === edge.owner &&
                candidate.display === display &&
                candidate.side === side &&
                fraction >= candidate.from &&
                fraction <= candidate.to &&
                Math.hypot(
                  surfacePoint(candidate, fraction).x - corner.x,
                  surfacePoint(candidate, fraction).y - corner.y,
                ) < 2,
            );
            if (
              adjacent &&
              surfacePositionFits(surfaceWindowPosition(corner, surfaceOrientation(side)), area)
            ) {
              this.attach(adjacent, fraction, now);
              this.attachment!.direction =
                side === WindowSurfaceSide.Top
                  ? edge.side === WindowSurfaceSide.Left
                    ? 1
                    : -1
                  : 1;
              return this.pose(corner, false);
            }
            if (this.startHop(corner, display, area, now, edge.owner))
              return { ...this.pose(corner, false), hopping: true };
            if (
              edge.side !== WindowSurfaceSide.Top &&
              attachment.direction > 0 &&
              endpoint >= 0.99999
            ) {
              this.attachment = null;
              this.orientation = PetOrientation.Upright;
              this.fall = { foot: corner, velocity: 0 };
            }
          }
          if (this.attachment) {
            attachment.direction *= -1;
            attachment.restUntil = nextRest(now);
            attachment.distance = 0;
            return this.pose(contact, false);
          }
        }
      }
      if (this.attachment) {
        const foot = surfaceFoot(position, this.orientation);
        this.attachment = null;
        this.orientation = PetOrientation.Upright;
        this.fall = { foot, velocity: 0 };
      }
    }
    if (this.fall) {
      const previous = {
        ...this.fall.foot,
        x: Math.max(area.x + 96, Math.min(area.x + area.width - 96, this.fall.foot.x)),
      };
      this.fall.velocity = Math.min(900, this.fall.velocity + GRAVITY * dt);
      const foot = { ...previous, y: previous.y + this.fall.velocity * dt };
      const ground = area.y + area.height - 12;
      let landed: { edge: WindowSurface; fraction: number; point: SurfacePoint } | undefined;
      for (const edge of this.surfaces) {
        if (edge.display !== display || edge.side !== WindowSurfaceSide.Top) continue;
        const fraction = (foot.x - edge.start.x) / (edge.end.x - edge.start.x);
        if (
          fraction < edge.from ||
          fraction > edge.to ||
          edge.start.y < previous.y ||
          edge.start.y > foot.y
        )
          continue;
        const point = surfacePoint(edge, fraction);
        if (!surfacePositionFits(surfaceWindowPosition(point, PetOrientation.Upright), area))
          continue;
        if (!landed || point.y < landed.point.y) landed = { edge, fraction, point };
      }
      if (landed && landed.point.y <= ground) {
        this.fall = null;
        this.attach(landed.edge, landed.fraction, now);
        return { ...this.pose(landed.point, false), landed: true };
      }
      if (foot.y >= ground) {
        this.fall = null;
        this.exploreAt = nextRest(now);
        const point = this.pose({ x: foot.x, y: ground }, false);
        return { ...point, y: area.y + area.height - DESKTOP_PET_WINDOW_HEIGHT, landed: true };
      }
      this.fall.foot = foot;
      return this.pose(foot, false);
    }
    this.walking = false;
    if (!allow || !this.surfaces.length) return null;
    const foot = surfaceFoot(position, PetOrientation.Upright);
    const nearest = this.candidate(foot, display, area);
    if (nearest && nearest.distance <= 6) {
      this.attach(nearest.edge, nearest.fraction, now);
      return this.pose(nearest.foot, false);
    }
    if (now >= this.exploreAt) {
      this.exploreAt = nextRest(now);
      if (this.startHop(foot, display, area, now))
        return { ...this.pose(foot, false), hopping: true };
    }
    return null;
  }
}
