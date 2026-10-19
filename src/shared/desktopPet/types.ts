import type { DesktopPetState } from './constants';

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
}

export interface DesktopPetPreferences {
  enabled: boolean;
  x?: number;
  y?: number;
}
