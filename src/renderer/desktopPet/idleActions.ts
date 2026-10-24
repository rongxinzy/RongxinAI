const IDLE_ACTION_MIN_MS = 9_000;
const IDLE_ACTION_JITTER_MS = 14_000;
const ACTION_MS = 900;

export const DesktopPetIdleKind = {
  None: 'none',
  Peek: 'peek',
  Nod: 'nod',
  Flutter: 'flutter',
} as const;
export type DesktopPetIdleKind = (typeof DesktopPetIdleKind)[keyof typeof DesktopPetIdleKind];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Procedural idle motion layered on top of the breathing spring. */
export class DesktopPetIdleActions {
  private nextAt = 0;
  private until = 0;
  private kind: DesktopPetIdleKind = DesktopPetIdleKind.None;
  private facing = 1;

  setFacing(value: number): void {
    this.facing = value >= 0 ? 1 : -1;
  }

  sample(
    now: number,
    active: boolean,
  ): {
    rotate: number;
    offsetX: number;
    offsetY: number;
    greetingBoost: number;
  } {
    if (!active) {
      this.kind = DesktopPetIdleKind.None;
      return { rotate: 0, offsetX: 0, offsetY: 0, greetingBoost: 0 };
    }
    if (this.kind === DesktopPetIdleKind.None && now >= this.nextAt) {
      const roll = Math.random();
      if (roll < 0.34) this.kind = DesktopPetIdleKind.Peek;
      else if (roll < 0.67) this.kind = DesktopPetIdleKind.Nod;
      else this.kind = DesktopPetIdleKind.Flutter;
      this.until = now + ACTION_MS;
      if (this.kind === DesktopPetIdleKind.Peek) this.facing *= -1;
    }
    if (this.kind !== DesktopPetIdleKind.None && now >= this.until) {
      this.kind = DesktopPetIdleKind.None;
      this.nextAt =
        now + randomBetween(IDLE_ACTION_MIN_MS, IDLE_ACTION_MIN_MS + IDLE_ACTION_JITTER_MS);
    }
    const progress =
      this.kind === DesktopPetIdleKind.None
        ? 0
        : Math.max(0, Math.min(1, 1 - (this.until - now) / ACTION_MS));
    const wave = Math.sin(progress * Math.PI);
    switch (this.kind) {
      case DesktopPetIdleKind.Peek:
        return {
          rotate: this.facing * 0.11 * wave,
          offsetX: this.facing * 7 * wave,
          offsetY: 0,
          greetingBoost: 0,
        };
      case DesktopPetIdleKind.Nod:
        return {
          rotate: 0,
          offsetX: 0,
          offsetY: -5 * wave,
          greetingBoost: 0,
        };
      case DesktopPetIdleKind.Flutter:
        return {
          rotate: this.facing * 0.05 * wave,
          offsetX: 0,
          offsetY: -3 * wave,
          greetingBoost: 0.55 * wave,
        };
      default:
        return { rotate: 0, offsetX: 0, offsetY: 0, greetingBoost: 0 };
    }
  }
}
