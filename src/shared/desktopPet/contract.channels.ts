import { DesktopPetIpc } from './constants';

export const desktopPetContractChannels = {
  getSettings: DesktopPetIpc.GetSettings,
  setSettings: DesktopPetIpc.SetSettings,
  getPendingTask: DesktopPetIpc.GetPendingTask,
  resolveTask: DesktopPetIpc.ResolveTask,
} as const;

export const desktopPetEventChannels = {
  ready: DesktopPetIpc.Ready,
  dragStart: DesktopPetIpc.DragStart,
  dragEnd: DesktopPetIpc.DragEnd,
  menu: DesktopPetIpc.Menu,
  open: DesktopPetIpc.Open,
  hitMask: DesktopPetIpc.HitMask,
  motion: DesktopPetIpc.Motion,
  walkFrame: DesktopPetIpc.WalkFrame,
} as const;
