/** Local curated idle and action chatter — no LLM / network. */

import { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';

export const DESKTOP_PET_CHATTER_KEYS = [
  'desktopPet_chatter_1',
  'desktopPet_chatter_2',
  'desktopPet_chatter_3',
  'desktopPet_chatter_4',
  'desktopPet_chatter_5',
  'desktopPet_chatter_6',
  'desktopPet_chatter_7',
  'desktopPet_chatter_8',
  'desktopPet_chatter_9',
  'desktopPet_chatter_10',
] as const;

export type DesktopPetChatterKey = (typeof DESKTOP_PET_CHATTER_KEYS)[number];

export const DESKTOP_PET_ACTION_CHATTER_KEYS = {
  [DesktopPetPlayableAction.Happy]: 'desktopPet_chatter_action_happy',
  [DesktopPetPlayableAction.Peek]: 'desktopPet_chatter_action_peek',
  [DesktopPetPlayableAction.Nod]: 'desktopPet_chatter_action_nod',
  [DesktopPetPlayableAction.Flutter]: 'desktopPet_chatter_action_flutter',
} as const;

const REST_MIN_MS = 22_000;
const REST_JITTER_MS = 28_000;
const SHOW_MS = 3_500;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickKey(exclude: string | null): DesktopPetChatterKey {
  const pool =
    exclude == null
      ? DESKTOP_PET_CHATTER_KEYS
      : DESKTOP_PET_CHATTER_KEYS.filter(key => key !== exclude);
  const choices = pool.length > 0 ? pool : DESKTOP_PET_CHATTER_KEYS;
  return choices[Math.floor(Math.random() * choices.length)]!;
}

/** Infrequent idle phrase scheduler; task bubbles stay outside this module. */
export class DesktopPetChatter {
  private nextAt = 0;
  private until = 0;
  private key: string | null = null;
  private lastKey: DesktopPetChatterKey | null = null;
  private forced = false;

  reset(now: number): void {
    this.key = null;
    this.until = 0;
    this.forced = false;
    this.nextAt = now + randomBetween(REST_MIN_MS, REST_MIN_MS + REST_JITTER_MS);
  }

  clear(): void {
    this.key = null;
    this.until = 0;
    this.forced = false;
  }

  activeKey(): string | null {
    return this.key;
  }

  showAction(action: DesktopPetPlayableAction, now: number): void {
    this.key = DESKTOP_PET_ACTION_CHATTER_KEYS[action];
    this.until = now + SHOW_MS;
    this.forced = true;
  }

  /**
   * Advance scheduler. When `allow` is false, clears idle phrases and
   * reschedules, but preserves an action phrase for its full show window.
   * Returns true when the active phrase changed (show or clear).
   */
  tick(now: number, allow: boolean): boolean {
    if (!allow && !this.forced) {
      const had = this.key != null;
      this.reset(now);
      return had;
    }
    if (this.key != null) {
      if (now < this.until) return false;
      this.key = null;
      this.forced = false;
      this.nextAt = now + randomBetween(REST_MIN_MS, REST_MIN_MS + REST_JITTER_MS);
      return true;
    }
    if (!allow) {
      this.reset(now);
      return false;
    }
    if (now < this.nextAt) return false;
    const key = pickKey(this.lastKey);
    this.key = key;
    this.lastKey = key;
    this.until = now + SHOW_MS;
    return true;
  }
}
