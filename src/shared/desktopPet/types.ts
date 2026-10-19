import type { DesktopPetState } from './constants';

export type DesktopPetEffect =
  | { kind: 'drag'; active: boolean }
  | { kind: 'impact'; strength: number };

export interface DesktopPetSnapshot {
  state: DesktopPetState;
  label: string;
  reducedMotion: boolean;
}

export interface DesktopPetBridge {
  ready(): void;
  dragStart(): void;
  dragEnd(): void;
  menu(): void;
  open(): void;
  hitMask(mask: Uint8Array): void;
  motion(reduced: boolean): void;
  onState(listener: (state: DesktopPetSnapshot) => void): () => void;
  onEffect(listener: (effect: DesktopPetEffect) => void): () => void;
}

export interface DesktopPetPreferences {
  enabled: boolean;
  x?: number;
  y?: number;
}
