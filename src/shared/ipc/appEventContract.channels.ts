import { ContextMenuIpc, LogIpc, NetworkIpc, WindowIpc } from './channels';

export const appEventChannels = {
  contextMenuExecute: ContextMenuIpc.Execute,
  windowMinimize: WindowIpc.Minimize,
  windowToggleMaximize: WindowIpc.ToggleMaximize,
  windowClose: WindowIpc.Close,
  windowShowSystemMenu: WindowIpc.ShowSystemMenu,
  networkStatusChange: NetworkIpc.StatusChange,
  logFromRenderer: LogIpc.FromRenderer,
} as const;
