import type { NvidiaSmiSnapshot } from '../../shared/hardware';

import { getNvidiaSmiSnapshot } from './nvidiaSmi';

export async function getLlamaCppNvidiaSnapshot(): Promise<NvidiaSmiSnapshot | null> {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return null;
  }
  try {
    return await getNvidiaSmiSnapshot();
  } catch {
    return null;
  }
}

export function hasAvailableNvidiaGpu(snapshot: NvidiaSmiSnapshot | null | undefined): boolean {
  return Boolean(snapshot?.available && snapshot.gpus.length > 0);
}
