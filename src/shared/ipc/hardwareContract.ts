import { z } from 'zod';

import { NvidiaSmiSnapshotSchema, SystemMemorySnapshotSchema } from '../hardware/types';
import { defineIpcContract } from './contract';
import { hardwareContractChannels } from './hardwareContract.channels';

export const hardwareContract = defineIpcContract({
  nvidiaSmi: {
    channel: hardwareContractChannels.nvidiaSmi,
    args: z.tuple([]),
    result: NvidiaSmiSnapshotSchema,
  },
  systemMemory: {
    channel: hardwareContractChannels.systemMemory,
    args: z.tuple([]),
    result: SystemMemorySnapshotSchema,
  },
});
