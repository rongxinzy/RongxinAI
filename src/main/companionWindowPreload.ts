import { contextBridge, ipcRenderer } from 'electron';
import { CompanionIpc as IpcChannel } from '../shared/ipc/channels';
import type { CompanionWindowApi } from '../shared/companion/types';

const api: CompanionWindowApi = {
  bootstrap: () => ipcRenderer.invoke(IpcChannel.Bootstrap),
  select: petId => ipcRenderer.invoke(IpcChannel.Select, petId),
  submit: request => ipcRenderer.invoke(IpcChannel.Submit, request),
  answer: receipt => ipcRenderer.invoke(IpcChannel.Answer, receipt),
  stop: () => ipcRenderer.invoke(IpcChannel.Stop),
  hide: () => ipcRenderer.invoke(IpcChannel.Hide),
  openWorkbench: () => ipcRenderer.invoke(IpcChannel.OpenWorkbench),
  onContext: listener => {
    const handle = (_event: Electron.IpcRendererEvent, context: Parameters<typeof listener>[0]) =>
      listener(context);
    ipcRenderer.on(IpcChannel.Context, handle);
    return () => ipcRenderer.removeListener(IpcChannel.Context, handle);
  },
  onVisibility: listener => {
    const handle = (_event: Electron.IpcRendererEvent, visible: boolean) => listener(visible);
    ipcRenderer.on(IpcChannel.Visibility, handle);
    return () => ipcRenderer.removeListener(IpcChannel.Visibility, handle);
  },
};
contextBridge.exposeInMainWorld('companion', api);
// Shared page chrome reads only the platform. No general application IPC is exposed here.
contextBridge.exposeInMainWorld('electron', { platform: process.platform });
