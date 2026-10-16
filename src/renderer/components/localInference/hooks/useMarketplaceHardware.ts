import { useEffect, useState } from 'react';

import {
  createMarketplaceHardwareProfile,
  type MarketplaceHardwareProfile,
} from '../../../../shared/marketplace/scoring';

/**
 * Detects the local GPU and system memory once, so marketplace models can be
 * scored and filtered for this device.
 */
export function useMarketplaceHardware(): {
  hardware: MarketplaceHardwareProfile | undefined;
  hardwareChecked: boolean;
} {
  const [hardware, setHardware] = useState<MarketplaceHardwareProfile>();
  const [hardwareChecked, setHardwareChecked] = useState(false);

  useEffect(() => {
    void Promise.all([
      typeof window.electron.hardware.nvidiaSmi === 'function'
        ? window.electron.hardware.nvidiaSmi().catch(() => null)
        : Promise.resolve(null),
      typeof window.electron.hardware.systemMemory === 'function'
        ? window.electron.hardware.systemMemory().catch(() => null)
        : Promise.resolve(null),
    ]).then(([gpuSnapshot, memorySnapshot]) => {
      setHardware(createMarketplaceHardwareProfile(gpuSnapshot, memorySnapshot));
      setHardwareChecked(true);
    });
  }, []);

  return { hardware, hardwareChecked };
}
