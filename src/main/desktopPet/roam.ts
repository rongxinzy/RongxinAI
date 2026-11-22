import type { ThrowBounds } from '../../shared/desktopPet/physics';
import type { DesktopPetWalkFrame } from '../../shared/desktopPet/contract';
import { XIAOYUAN_WALK_SECONDS } from '../../shared/desktopPet/motionCatalog';

export const DesktopPetRoamPhase = {
  Rest: 'rest',
  Walk: 'walk',
} as const;
export type DesktopPetRoamPhase = (typeof DesktopPetRoamPhase)[keyof typeof DesktopPetRoamPhase];

const REST_MIN_MS = 18_000;
const REST_JITTER_MS = 22_000;
const WALK_MIN_PX = 72;
const WALK_JITTER_PX = 120;
const WALK_SPEED_PX_S = 42;
const ARRIVE_PX = 2;
const WALK_LEAD_SECONDS = 0.12;
const WALK_TAIL_SECONDS = 0.25;
const WALK_TRAVEL_END_SECONDS = XIAOYUAN_WALK_SECONDS - WALK_TAIL_SECONDS;
const WALK_START_TIMEOUT_MS = 2500;
const WALK_FRAME_TIMEOUT_MS = 750;
const WALK_TIMEOUT_MS =
  WALK_START_TIMEOUT_MS + XIAOYUAN_WALK_SECONDS * 1000 + WALK_FRAME_TIMEOUT_MS;

interface RoamStep {
  x: number;
  y: number;
  facing: number;
  walking: boolean;
  walkId?: number;
}

interface MediaWalk {
  id: number;
  startX: number;
  startedAt: number;
  frame?: { mediaTime: number; receivedAt: number };
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Gentle horizontal roaming along the current row; no vertical travel. */
export class DesktopPetRoam {
  private phase: DesktopPetRoamPhase = DesktopPetRoamPhase.Rest;
  private restUntil = 0;
  private targetX = 0;
  private positionX = 0;
  private facing = 1;
  private mediaDriven = false;
  private walkSequence = 0;
  private mediaWalk: MediaWalk | undefined;

  reset(now: number): void {
    this.phase = DesktopPetRoamPhase.Rest;
    this.mediaWalk = undefined;
    this.restUntil = now + randomBetween(REST_MIN_MS, REST_MIN_MS + REST_JITTER_MS);
  }

  setMediaDriven(enabled: boolean, now: number): void {
    if (this.mediaDriven === enabled) return;
    this.mediaDriven = enabled;
    this.reset(now);
  }

  observeMediaFrame(frame: DesktopPetWalkFrame, now: number): void {
    const walk = this.mediaWalk;
    if (
      !walk ||
      this.expired(walk, now) ||
      frame.walkId !== walk.id ||
      !(frame.mediaTime >= 0 && frame.mediaTime <= XIAOYUAN_WALK_SECONDS) ||
      frame.mediaTime <= (walk.frame?.mediaTime ?? -1)
    )
      return;
    walk.frame = { mediaTime: frame.mediaTime, receivedAt: now };
  }

  get facingDirection(): number {
    return this.facing;
  }

  isWalking(): boolean {
    return this.phase === DesktopPetRoamPhase.Walk;
  }

  tick(
    now: number,
    position: { x: number; y: number },
    bounds: ThrowBounds,
    allow: boolean,
    elapsedMs = 16,
  ): RoamStep | null {
    if (!allow) {
      this.reset(now);
      return null;
    }
    if (this.phase === DesktopPetRoamPhase.Rest) {
      if (now < this.restUntil) return null;
      const distance = randomBetween(WALK_MIN_PX, WALK_MIN_PX + WALK_JITTER_PX);
      const leftRoom = position.x - bounds.minX;
      const rightRoom = bounds.maxX - position.x;
      const goRight =
        this.mediaDriven && Math.min(leftRoom, rightRoom) < WALK_MIN_PX
          ? rightRoom > leftRoom
          : rightRoom < 24 || (leftRoom > 24 && Math.random() < 0.5);
      if (goRight && rightRoom > 8) {
        this.facing = 1;
        this.targetX = Math.min(bounds.maxX, position.x + distance);
      } else if (leftRoom > 8) {
        this.facing = -1;
        this.targetX = Math.max(bounds.minX, position.x - distance);
      } else if (rightRoom > 8) {
        this.facing = 1;
        this.targetX = Math.min(bounds.maxX, position.x + distance);
      } else {
        this.restUntil = now + randomBetween(REST_MIN_MS / 2, REST_MIN_MS);
        return null;
      }
      if (Math.abs(this.targetX - position.x) < ARRIVE_PX) {
        this.restUntil = now + randomBetween(REST_MIN_MS, REST_MIN_MS + REST_JITTER_MS);
        return null;
      }
      this.positionX = position.x;
      this.phase = DesktopPetRoamPhase.Walk;
      if (this.mediaDriven)
        this.mediaWalk = { id: ++this.walkSequence, startX: position.x, startedAt: now };
    }
    if (this.mediaWalk) return this.mediaStep(this.mediaWalk, now, position.y, bounds);
    const delta = this.targetX - this.positionX;
    if (Math.abs(delta) <= ARRIVE_PX) {
      this.phase = DesktopPetRoamPhase.Rest;
      this.restUntil = now + randomBetween(REST_MIN_MS, REST_MIN_MS + REST_JITTER_MS);
      return { x: this.targetX, y: position.y, facing: this.facing, walking: false };
    }
    const step = Math.sign(delta) * Math.min(Math.abs(delta), (WALK_SPEED_PX_S * elapsedMs) / 1000);
    this.positionX += step;
    return {
      x: this.positionX,
      y: position.y,
      facing: this.facing,
      walking: true,
    };
  }

  private expired(walk: MediaWalk, now: number): boolean {
    return (
      now - walk.startedAt >= WALK_TIMEOUT_MS ||
      (walk.frame
        ? now - walk.frame.receivedAt >= WALK_FRAME_TIMEOUT_MS
        : now - walk.startedAt >= WALK_START_TIMEOUT_MS)
    );
  }

  private mediaStep(walk: MediaWalk, now: number, y: number, bounds: ThrowBounds): RoamStep | null {
    if (this.expired(walk, now)) {
      this.reset(now);
      return null;
    }
    // Adapted from dsh-pet's startMoveDrive (MIT, Copyright 2026 PC2005-cloud; see public/licenses/dsh-pet.txt).
    // Source: 4e589f6dacabbd3170e91e7a213b2a7afff1a09b, runtime/electron-helper/sprite/motion.js.
    const mediaTime = walk.frame?.mediaTime ?? 0;
    const progress = Math.max(
      0,
      Math.min(1, (mediaTime - WALK_LEAD_SECONDS) / (WALK_TRAVEL_END_SECONDS - WALK_LEAD_SECONDS)),
    );
    const x = Math.max(
      bounds.minX,
      Math.min(bounds.maxX, walk.startX + (this.targetX - walk.startX) * progress),
    );
    if (mediaTime >= XIAOYUAN_WALK_SECONDS) {
      this.reset(now);
      return { x, y, facing: this.facing, walking: false };
    }
    return { x, y, facing: this.facing, walking: true, walkId: walk.id };
  }
}
