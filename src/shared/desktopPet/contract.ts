import { z } from 'zod';

import { defineIpcContract } from '../ipc/contract';
import { DESKTOP_PET_SIZE, DesktopPetTaskResult } from './constants';
import { DesktopPetBuiltinId } from './catalog';
import { desktopPetContractChannels, desktopPetEventChannels } from './contract.channels';

const settings = z.object({
  characterId: z.enum(Object.values(DesktopPetBuiltinId)),
  enabled: z.boolean(),
  doNotDisturb: z.boolean(),
  hideInFullscreen: z.boolean(),
  roaming: z.boolean(),
  chatter: z.boolean(),
});
export const desktopPetContract = defineIpcContract({
  getSettings: {
    channel: desktopPetContractChannels.getSettings,
    args: z.tuple([]),
    result: settings,
  },
  setSettings: {
    channel: desktopPetContractChannels.setSettings,
    args: z.tuple([settings.partial().strict()]),
    result: settings,
  },
  getPendingTask: {
    channel: desktopPetContractChannels.getPendingTask,
    args: z.tuple([]),
    result: z.object({ requestId: z.number(), sessionId: z.string() }).nullable(),
  },
  resolveTask: {
    channel: desktopPetContractChannels.resolveTask,
    args: z.tuple([z.number().int().positive(), z.enum(Object.values(DesktopPetTaskResult))]),
    result: z.void(),
  },
});

const noArgs = z.tuple([]);
const walkFrame = z.object({ walkId: z.number().int().positive(), mediaTime: z.number() });
export type DesktopPetWalkFrame = z.output<typeof walkFrame>;

export const desktopPetEventContract = {
  ready: { channel: desktopPetEventChannels.ready, args: noArgs },
  dragStart: { channel: desktopPetEventChannels.dragStart, args: noArgs },
  dragEnd: { channel: desktopPetEventChannels.dragEnd, args: z.tuple([z.boolean().optional()]) },
  menu: { channel: desktopPetEventChannels.menu, args: noArgs },
  open: { channel: desktopPetEventChannels.open, args: noArgs },
  hitMask: {
    channel: desktopPetEventChannels.hitMask,
    args: z.tuple([
      z.custom<Uint8Array>(
        mask => mask instanceof Uint8Array && mask.length === DESKTOP_PET_SIZE * DESKTOP_PET_SIZE,
      ),
    ]),
  },
  motion: { channel: desktopPetEventChannels.motion, args: z.tuple([z.boolean()]) },
  walkFrame: { channel: desktopPetEventChannels.walkFrame, args: z.tuple([walkFrame]) },
} as const;
