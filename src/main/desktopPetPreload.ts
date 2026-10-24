import { contextBridge, ipcRenderer } from 'electron';

import { DesktopPetIpc } from '../shared/desktopPet/constants';
import type {
  DesktopPetBridge,
  DesktopPetEffect,
  DesktopPetPose,
  DesktopPetSnapshot,
} from '../shared/desktopPet/types';

const bridge: DesktopPetBridge = {
  ready: () => ipcRenderer.send(DesktopPetIpc.Ready),
  dragStart: () => ipcRenderer.send(DesktopPetIpc.DragStart),
  dragEnd: () => ipcRenderer.send(DesktopPetIpc.DragEnd),
  menu: () => ipcRenderer.send(DesktopPetIpc.Menu),
  open: () => ipcRenderer.send(DesktopPetIpc.Open),
  hitMask: mask => ipcRenderer.send(DesktopPetIpc.HitMask, mask),
  motion: reduced => ipcRenderer.send(DesktopPetIpc.Motion, reduced),
  onState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopPetSnapshot) =>
      listener(state);
    ipcRenderer.on(DesktopPetIpc.State, handler);
    return () => ipcRenderer.removeListener(DesktopPetIpc.State, handler);
  },
  onPose: listener => {
    const handler = (_event: Electron.IpcRendererEvent, pose: DesktopPetPose) => listener(pose);
    ipcRenderer.on(DesktopPetIpc.Pose, handler);
    return () => ipcRenderer.removeListener(DesktopPetIpc.Pose, handler);
  },
  onEffect: listener => {
    const handler = (_event: Electron.IpcRendererEvent, effect: DesktopPetEffect) =>
      listener(effect);
    ipcRenderer.on(DesktopPetIpc.Effect, handler);
    return () => ipcRenderer.removeListener(DesktopPetIpc.Effect, handler);
  },
};

contextBridge.exposeInMainWorld('desktopPet', bridge);
