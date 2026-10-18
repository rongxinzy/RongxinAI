import type { IpcContractApi } from '../../shared/ipc/contract';
import type { memoryContract } from '../../shared/ipc/memoryContract';
import { memoryContractChannels } from '../../shared/ipc/memoryContract.channels';
import { createIpcInvokers } from './createIpcInvokers';

// Memory search, manual curation, and candidate confirmation.
export const memoryApi = {
  memory: {
    ...createIpcInvokers(memoryContractChannels),
  } as IpcContractApi<typeof memoryContract>,
};
