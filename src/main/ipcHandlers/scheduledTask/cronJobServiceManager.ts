import { CronJobService } from '../../../scheduledTask/cronJobService';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { emitChannelRunEvent } from '../../im/channelRunEvents';

type GatewayClientLike = {
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean },
  ) => Promise<T>;
};

export interface CronJobServiceDeps {
  /** Canonical service takes precedence during the cc-connect migration. */
  getScheduledTaskService?: () => ScheduledTaskService;
  getOpenClawChannelGateway: () => {
    getGatewayClient: () => GatewayClientLike | null;
    ensureReady: () => Promise<void>;
    onGatewayDisconnect: (callback: (reason: string) => void) => () => void;
    onGatewayReconnect: (callback: () => void) => () => void;
  } | null;
}

let cronJobService: ScheduledTaskService | null = null;
let deps: CronJobServiceDeps | null = null;

export function initCronJobServiceManager(d: CronJobServiceDeps): void {
  deps = d;
}

export function getCronJobService(): ScheduledTaskService {
  if (!cronJobService) {
    if (!deps) {
      throw new Error(
        'CronJobServiceManager not initialized. Call initCronJobServiceManager() first.',
      );
    }
    const canonical = deps.getScheduledTaskService?.();
    if (canonical) {
      cronJobService = canonical;
      return canonical;
    }
    const adapter = deps.getOpenClawChannelGateway();
    if (!adapter) {
      throw new Error(
        'OpenClaw runtime adapter not initialized. CronJobService requires OpenClaw.',
      );
    }
    const service = new CronJobService({
      getGatewayClient: () => adapter.getGatewayClient(),
      ensureGatewayReady: () => adapter.ensureReady(),
      onChannelRunEvent: emitChannelRunEvent,
    });
    adapter.onGatewayDisconnect(() => service.handleGatewayDisconnected());
    adapter.onGatewayReconnect(() => service.handleGatewayConnected());
    cronJobService = service;
  }
  return cronJobService;
}
