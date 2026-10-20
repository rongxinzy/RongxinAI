import type { MagpieStatus } from '../../shared/magpie/types';

/** Loopback management API surface used by {@link MagpieRoutingUsageService}. */
export interface MagpieRoutingGateway {
  ensureRunning(): Promise<MagpieStatus>;
  managementRequest(route: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
}
