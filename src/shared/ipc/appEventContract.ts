import { z } from 'zod';

import { ContextMenuAction } from '../contextMenu';
import { appEventChannels } from './appEventContract.channels';

export const NetworkStatus = {
  Online: 'online',
  Offline: 'offline',
} as const;

const noArgs = z.tuple([]);
const windowMenuPosition = z.object({ x: z.number().optional(), y: z.number().optional() });
export type WindowMenuPosition = z.output<typeof windowMenuPosition>;

export const appEventContract = {
  contextMenuExecute: {
    channel: appEventChannels.contextMenuExecute,
    args: z.tuple([z.enum(ContextMenuAction)]),
  },
  windowMinimize: { channel: appEventChannels.windowMinimize, args: noArgs },
  windowToggleMaximize: { channel: appEventChannels.windowToggleMaximize, args: noArgs },
  windowClose: { channel: appEventChannels.windowClose, args: noArgs },
  windowShowSystemMenu: {
    channel: appEventChannels.windowShowSystemMenu,
    args: z.tuple([windowMenuPosition.optional()]),
  },
  networkStatusChange: {
    channel: appEventChannels.networkStatusChange,
    args: z.tuple([z.enum(NetworkStatus)]),
  },
  logFromRenderer: {
    channel: appEventChannels.logFromRenderer,
    args: z.tuple([z.string(), z.string(), z.string()]),
  },
} as const;
