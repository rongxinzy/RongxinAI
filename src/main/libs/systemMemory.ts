import os from 'os';

import type { SystemMemorySnapshot } from '../../shared/hardware';

export function getSystemMemorySnapshot(): SystemMemorySnapshot {
  try {
    return {
      source: 'system',
      available: true,
      checkedAt: new Date().toISOString(),
      totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMiB: Math.round(os.freemem() / 1024 / 1024),
    };
  } catch (error) {
    return {
      source: 'system',
      available: false,
      checkedAt: new Date().toISOString(),
      totalMemoryMiB: 0,
      freeMemoryMiB: 0,
      error: error instanceof Error ? error.message : 'system memory unavailable',
    };
  }
}
