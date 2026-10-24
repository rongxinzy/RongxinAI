import type { ThrowBounds } from '../../shared/desktopPet/physics';

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

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Gentle horizontal roaming along the current row; no vertical travel. */
export class DesktopPetRoam {
  private phase: DesktopPetRoamPhase = DesktopPetRoamPhase.Rest;
  private restUntil = 0;
  private targetX = 0;
  private facing = 1;

  reset(now: number): void {
    this.phase = DesktopPetRoamPhase.Rest;
    this.restUntil = now + randomBetween(REST_MIN_MS, REST_MIN_MS + REST_JITTER_MS);
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
  ): { x: number; y: number; facing: number; walking: boolean } | null {
    if (!allow) {
      this.reset(now);
      return null;
    }
    if (this.phase === DesktopPetRoamPhase.Rest) {
      if (now < this.restUntil) return null;
      const distance = randomBetween(WALK_MIN_PX, WALK_MIN_PX + WALK_JITTER_PX);
      const leftRoom = position.x - bounds.minX;
      const rightRoom = bounds.maxX - position.x;
      const goRight = rightRoom < 24 || (leftRoom > 24 && Math.random() < 0.5);
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
      this.phase = DesktopPetRoamPhase.Walk;
    }
    const delta = this.targetX - position.x;
    if (Math.abs(delta) <= ARRIVE_PX) {
      this.phase = DesktopPetRoamPhase.Rest;
      this.restUntil = now + randomBetween(REST_MIN_MS, REST_MIN_MS + REST_JITTER_MS);
      return { x: Math.round(this.targetX), y: position.y, facing: this.facing, walking: false };
    }
    const step = Math.sign(delta) * Math.min(Math.abs(delta), (WALK_SPEED_PX_S * 16) / 1000);
    return {
      x: Math.round(position.x + step),
      y: position.y,
      facing: this.facing,
      walking: true,
    };
  }
}
