import { ipcRenderer } from 'electron';
import { CompanionIpc as IpcChannel } from '../../shared/ipc/channels';
import type { CompanionWindowApi } from '../../shared/companion/types';

/** Both owned surfaces share the same validated IPC and durable conversation. */
export const companionApi: CompanionWindowApi = {
  bootstrap: () => ipcRenderer.invoke(IpcChannel.Bootstrap),
  select: petId => ipcRenderer.invoke(IpcChannel.Select, petId),
  submit: request => ipcRenderer.invoke(IpcChannel.Submit, request),
  answer: receipt => ipcRenderer.invoke(IpcChannel.Answer, receipt),
  stop: petId => ipcRenderer.invoke(IpcChannel.Stop, petId),
  submitTask: request => ipcRenderer.invoke(IpcChannel.SubmitTask, request),
  tasks: () => ipcRenderer.invoke(IpcChannel.Tasks),
  stopTask: sessionId => ipcRenderer.invoke(IpcChannel.StopTask, sessionId),
  chooseWorkspace: () => ipcRenderer.invoke(IpcChannel.ChooseWorkspace),
  hide: () => ipcRenderer.invoke(IpcChannel.Hide),
  openWorkbench: sessionId => ipcRenderer.invoke(IpcChannel.OpenWorkbench, sessionId),
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
  onTasks: listener => {
    const handle = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
      listener(payload);
    ipcRenderer.on(IpcChannel.TasksChanged, handle);
    return () => ipcRenderer.removeListener(IpcChannel.TasksChanged, handle);
  },
  onChanged: listener => {
    const handle = () => listener();
    ipcRenderer.on(IpcChannel.Changed, handle);
    return () => ipcRenderer.removeListener(IpcChannel.Changed, handle);
  },
  onWorkbench: listener => {
    const handle = () => listener();
    ipcRenderer.on(IpcChannel.Workbench, handle);
    return () => ipcRenderer.removeListener(IpcChannel.Workbench, handle);
  },
};
