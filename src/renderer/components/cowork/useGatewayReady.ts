import { useEffect, useState } from 'react';

import { isOpenClawGatewayRunning } from '../../../shared/openclaw/status';
import { coworkService } from '../../services/cowork';
import type { OpenClawEngineStatus } from '../../types/cowork';

function isGatewayRunning(status: OpenClawEngineStatus | null): boolean {
  return isOpenClawGatewayRunning(status?.phase);
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
