import type { CcConnectAccountRuntimeStatus } from './ccConnectRuntimeStatusRegistry';
import { CcConnectRuntimeStatusRegistry } from './ccConnectRuntimeStatusRegistry';

export function resolveCcConnectAccountRuntimeStatus(
  statuses: CcConnectRuntimeStatusRegistry,
  accountId: string,
  runtimeRunning: boolean,
): CcConnectAccountRuntimeStatus {
  const status = statuses.get(accountId);
  return {
    ...status,
    connected: runtimeRunning && status.connected,
  };
}
