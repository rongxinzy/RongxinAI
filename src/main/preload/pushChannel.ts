import { ipcRenderer } from 'electron';

// Helper: typed main→renderer push listener with automatic cleanup
export const onPush = <T>(channel: string, callback: (data: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

// Helper: typed main→renderer push listener with no data payload
export const onPushVoid = (channel: string, callback: () => void): (() => void) => {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};
