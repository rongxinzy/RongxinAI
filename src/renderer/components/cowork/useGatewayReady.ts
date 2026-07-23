import { useEffect, useState } from 'react';

import { coworkService } from '../../services/cowork';
import type { OpenClawEngineStatus } from '../../types/cowork';

const OpenClawEnginePhase = {
  Running: 'running',
} as const;

function isGatewayRunning(status: OpenClawEngineStatus | null): boolean {
  return status?.phase === OpenClawEnginePhase.Running;
}

export function useGatewayReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void coworkService.getOpenClawEngineStatus().then(status => {
      setReady(isGatewayRunning(status));
    });

    return coworkService.onOpenClawEngineStatus(status => {
      setReady(isGatewayRunning(status));
    });
  }, []);

  return ready;
}
