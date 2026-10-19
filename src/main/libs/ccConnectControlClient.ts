import { CcConnectProtocol, type CcConnectHealth } from '../../shared/ccConnect/constants';
import { createCcConnectProtocolHeaders, isCcConnectHealth } from '../../shared/ccConnect/protocol';

/**
 * Sidecar control-plane client: health verification only. The scheduler clock
 * lives in the main process (work package E), so cron task upsert/remove and
 * trigger routes are gone; the sidecar is a channel runtime, not a clock.
 */
export class CcConnectControlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async healthCheck(expectedPid?: number): Promise<CcConnectHealth> {
    const response = await this.request('/v1/cc-connect/cron/health', { method: 'GET' }, 200);
    const health: unknown = await response.json();
    const requiredCapabilities = [
      CcConnectProtocol.Capability.TriggerOnlyCron,
      CcConnectProtocol.Capability.ChannelPolicy,
      CcConnectProtocol.Capability.MediaReply,
      CcConnectProtocol.Capability.RuntimeActivity,
    ];
    if (
      !isCcConnectHealth(health) ||
      requiredCapabilities.some(capability => !health.capabilities.includes(capability))
    ) {
      throw new Error('cc-connect returned an incompatible health contract');
    }
    if (expectedPid !== undefined && health.pid !== expectedPid) {
      throw new Error(
        `cc-connect health PID ${health.pid} does not match child PID ${expectedPid}`,
      );
    }
    if (health.parentPid !== process.pid) {
      throw new Error(
        `cc-connect parent PID ${health.parentPid} does not match desktop PID ${process.pid}`,
      );
    }
    return health;
  }

  private async request(path: string, init: RequestInit, expectedStatus = 204): Promise<Response> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        ...createCcConnectProtocolHeaders(),
        ...init.headers,
      },
    });
    if (response.status !== expectedStatus)
      throw new Error(`cc-connect cron control returned HTTP ${response.status}`);
    return response;
  }
}
