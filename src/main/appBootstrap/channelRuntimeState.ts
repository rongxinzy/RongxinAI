import type { CanonicalScheduledTaskService } from '../../scheduledTask/canonicalScheduledTaskService';
import type { CcConnectSchedulerRuntime } from '../../scheduledTask/ccConnectSchedulerRuntime';
import type { CcConnectControlClient } from '../libs/ccConnectControlClient';
import type { LocalCronClock } from '../../scheduledTask/localCronClock';
import type { CcConnectDeliveryTransport } from '../../scheduledTask/ccConnectDeliveryTransport';
import type { ActivityService } from '../activity/activityService';
import type { ChannelAccountManager } from '../im/channelAccountManager';
import type { CcConnectPiBridge } from '../im/ccConnectPiBridge';
import type { CcConnectBridgeServer } from '../libs/ccConnectBridgeServer';
import type { CcConnectRuntimeStatusRegistry } from '../libs/ccConnectRuntimeStatusRegistry';
import { CcConnectRuntimeStatusRegistry as CcConnectRuntimeStatusRegistryCtor } from '../libs/ccConnectRuntimeStatusRegistry';
import type { CcConnectSidecarManager } from '../libs/ccConnectSidecarManager';

/**
 * Channel/Cron transport state carved out of the shared `rt` locator (work
 * package I.1). One typed container per domain: cc-connect sidecars, the
 * bridge server, channel accounts, and the canonical scheduled-task runtime
 * they deliver through. Initialized lazily by ccConnectRuntime bootstrap.
 */
export interface ChannelRuntimeState {
  gatewayManager: ChannelAccountManager | null;
  bridgeServer: CcConnectBridgeServer | null;
  sidecarManager: CcConnectSidecarManager | null;
  statuses: CcConnectRuntimeStatusRegistry;
  deliveryAccounts: Set<string>;
  restartTimer: NodeJS.Timeout | null;
  stopping: boolean;
  reconcileQueue: Promise<void>;
  configSignature: string;
  controlClient: CcConnectControlClient | null;
  piBridge: CcConnectPiBridge | null;
  scheduledTaskService: CanonicalScheduledTaskService | null;
  activityService: ActivityService | null;
  schedulerRuntime: CcConnectSchedulerRuntime | null;
  schedulerClock: LocalCronClock | null;
  deliveryTransport: CcConnectDeliveryTransport | null;
  bridgeToken: string | null;
  bridgeUrl: string | null;
  restartAttempts: number;
}

export const channelRuntime: ChannelRuntimeState = {
  gatewayManager: null,
  bridgeServer: null,
  sidecarManager: null,
  statuses: new CcConnectRuntimeStatusRegistryCtor(),
  deliveryAccounts: new Set<string>(),
  restartTimer: null,
  stopping: false,
  reconcileQueue: Promise.resolve(),
  configSignature: '',
  controlClient: null,
  piBridge: null,
  scheduledTaskService: null,
  activityService: null,
  schedulerRuntime: null,
  schedulerClock: null,
  deliveryTransport: null,
  bridgeToken: null,
  bridgeUrl: null,
  restartAttempts: 0,
};
