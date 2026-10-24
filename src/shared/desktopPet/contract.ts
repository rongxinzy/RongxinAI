import { z } from 'zod';

import { defineIpcContract } from '../ipc/contract';
import { DesktopPetIpc, DesktopPetTaskResult } from './constants';
import { DesktopPetBuiltinId } from './catalog';

const settings = z.object({
  characterId: z.enum(Object.values(DesktopPetBuiltinId)),
  enabled: z.boolean(),
  doNotDisturb: z.boolean(),
  hideInFullscreen: z.boolean(),
  roaming: z.boolean(),
  chatter: z.boolean(),
});
export const desktopPetContract = defineIpcContract({
  getSettings: { channel: DesktopPetIpc.GetSettings, args: z.tuple([]), result: settings },
  setSettings: {
    channel: DesktopPetIpc.SetSettings,
    args: z.tuple([settings.partial().strict()]),
    result: settings,
  },
  getPendingTask: {
    channel: DesktopPetIpc.GetPendingTask,
    args: z.tuple([]),
    result: z.object({ requestId: z.number(), sessionId: z.string() }).nullable(),
  },
  resolveTask: {
    channel: DesktopPetIpc.ResolveTask,
    args: z.tuple([z.number().int().positive(), z.enum(Object.values(DesktopPetTaskResult))]),
    result: z.void(),
  },
});
