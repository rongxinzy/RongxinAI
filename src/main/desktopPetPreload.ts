import { contextBridge, ipcRenderer } from 'electron';

import { DesktopPetIpc } from '../shared/desktopPet/constants';
import type { DesktopPetBridge, DesktopPetSnapshot } from '../shared/desktopPet/types';

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
};

contextBridge.exposeInMainWorld('desktopPet', bridge);
