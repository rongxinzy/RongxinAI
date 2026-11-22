import type { DesktopPetPlayableAction, DesktopPetState } from './constants';
import type { DesktopPetBuiltinId } from './catalog';
import type { PetOrientation } from './surfaces/constants';
import type { desktopPetContract, desktopPetEventContract } from './contract';
import type { IpcContractApi, IpcEventApi } from '../ipc/contract';

type DesktopPetInvokeApi = IpcContractApi<typeof desktopPetContract>;

export type DesktopPetSettings = Awaited<ReturnType<DesktopPetInvokeApi['getSettings']>>;
export type DesktopPetTaskOpen = NonNullable<
  Awaited<ReturnType<DesktopPetInvokeApi['getPendingTask']>>
>;

export interface DesktopPetFailure {
  sessionId: string;
  eventId: string;
}

export type DesktopPetApi = DesktopPetInvokeApi & {
  onSettingsChanged(listener: (settings: DesktopPetSettings) => void): () => void;
  onOpenTask(listener: (request: DesktopPetTaskOpen) => void): () => void;
};

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
  walkId?: number;
}

export interface DesktopPetBridge extends IpcEventApi<typeof desktopPetEventContract> {
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
