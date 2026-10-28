import type { DesktopPetPlayableAction, DesktopPetState, DesktopPetTaskResult } from './constants';
import type { DesktopPetBuiltinId } from './catalog';
import type { PetOrientation } from './surfaces/constants';

export interface DesktopPetSettings {
  characterId: DesktopPetBuiltinId;
  enabled: boolean;
  doNotDisturb: boolean;
  hideInFullscreen: boolean;
  roaming: boolean;
  chatter: boolean;
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
  | { kind: 'visibility'; visible: boolean }
  | { kind: 'drag'; active: boolean }
  | { kind: 'impact'; strength: number }
  | { kind: 'action'; action: DesktopPetPlayableAction };

export interface DesktopPetSnapshot {
  characterId: DesktopPetBuiltinId;
  state: DesktopPetState;
  label: string;
  bubble: string | null;
  reducedMotion: boolean;
}

export interface DesktopPetPose {
  facing: number;
  walking: boolean;
  orientation: PetOrientation;
}

export interface DesktopPetBridge {
  ready(): void;
  dragStart(): void;
  dragEnd(cancelled?: boolean): void;
  menu(): void;
  open(): void;
  hitMask(mask: Uint8Array): void;
  motion(reduced: boolean): void;
  onState(listener: (state: DesktopPetSnapshot) => void): () => void;
  onPose(listener: (pose: DesktopPetPose) => void): () => void;
  onEffect(listener: (effect: DesktopPetEffect) => void): () => void;
}

export interface DesktopPetPreferences extends Partial<DesktopPetSettings> {
  enabled: boolean;
  x?: number;
  y?: number;
  layoutVersion?: number;
}
