import { contextBridge } from 'electron';

import { DesktopPetIpc } from '../shared/desktopPet/constants';
import type { desktopPetEventContract } from '../shared/desktopPet/contract';
import { desktopPetEventChannels } from '../shared/desktopPet/contract.channels';
import type { DesktopPetBridge } from '../shared/desktopPet/types';
import { createIpcEventSenders } from './preload/createIpcInvokers';
import { onPush } from './preload/pushChannel';

const events = createIpcEventSenders<typeof desktopPetEventContract>(desktopPetEventChannels);
const bridge: DesktopPetBridge = {
  ...events,
  dragEnd: cancelled => events.dragEnd(cancelled === true),
  onState: listener => onPush(DesktopPetIpc.State, listener),
  onPose: listener => onPush(DesktopPetIpc.Pose, listener),
  onEffect: listener => onPush(DesktopPetIpc.Effect, listener),
};

contextBridge.exposeInMainWorld('desktopPet', bridge);
