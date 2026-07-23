import { CronJobService } from '../../../scheduledTask/cronJobService';

type GatewayClientLike = {
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean },
  ) => Promise<T>;
};

export interface CronJobServiceDeps {
  getOpenClawRuntimeAdapter: () => {
    getGatewayClient: () => GatewayClientLike | null;
    ensureReady: () => Promise<void>;
    onGatewayDisconnect: (callback: (reason: string) => void) => () => void;
    onGatewayReconnect: (callback: () => void) => () => void;
  } | null;
}

let cronJobService: CronJobService | null = null;
let deps: CronJobServiceDeps | null = null;

export function initCronJobServiceManager(d: CronJobServiceDeps): void {
  deps = d;
}

export function getCronJobService(): CronJobService {
  if (!cronJobService) {
    if (!deps) {
      throw new Error(
        'CronJobServiceManager not initialized. Call initCronJobServiceManager() first.',
      );
    }
    const adapter = deps.getOpenClawRuntimeAdapter();
    if (!adapter) {
      throw new Error(
        'OpenClaw runtime adapter not initialized. CronJobService requires OpenClaw.',
      );
    }
    const service = new CronJobService({
      getGatewayClient: () => adapter.getGatewayClient(),
      ensureGatewayReady: () => adapter.ensureReady(),
    });
    adapter.onGatewayDisconnect(() => service.handleGatewayDisconnected());
    adapter.onGatewayReconnect(() => service.handleGatewayConnected());
    cronJobService = service;
  }
  return cronJobService;
}
