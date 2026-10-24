import { contextBridge } from 'electron';
import { companionApi } from './preload/companion';

contextBridge.exposeInMainWorld('companion', companionApi);
// Shared page chrome reads only the platform. No general application IPC is exposed here.
contextBridge.exposeInMainWorld('electron', { platform: process.platform });
