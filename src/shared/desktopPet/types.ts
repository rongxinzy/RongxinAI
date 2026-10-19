import type { DesktopPetState, DesktopPetTaskResult } from './constants';

export interface DesktopPetSettings {
  enabled: boolean;
  doNotDisturb: boolean;
  hideInFullscreen: boolean;
}

export interface DesktopPetTaskOpen {
  requestId: number;
  sessionId: string;
}

export interface DesktopPetFailure {
  sessionId: string;
  eventId: string;
}

export interface DesktopPetApi {
  getSettings(): Promise<DesktopPetSettings>;
  setSettings(patch: Partial<DesktopPetSettings>): Promise<DesktopPetSettings>;
  onSettingsChanged(listener: (settings: DesktopPetSettings) => void): () => void;
  onOpenTask(listener: (request: DesktopPetTaskOpen) => void): () => void;
  getPendingTask(): Promise<DesktopPetTaskOpen | null>;
  resolveTask(requestId: number, result: DesktopPetTaskResult): Promise<void>;
}

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

export interface DesktopPetPreferences extends Partial<DesktopPetSettings> {
  enabled: boolean;
  x?: number;
  y?: number;
}
