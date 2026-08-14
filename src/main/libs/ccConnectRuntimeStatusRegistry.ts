import type { CcConnectPlatformStatus } from '../../shared/ccConnect/constants';

export type CcConnectAccountRuntimeStatus = {
  connected: boolean;
  lastError: string | null;
  startedAt: number | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
};

const EMPTY_STATUS: CcConnectAccountRuntimeStatus = {
  connected: false,
  lastError: null,
  startedAt: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

export class CcConnectRuntimeStatusRegistry {
  private readonly statuses = new Map<string, CcConnectAccountRuntimeStatus>();

  replace(statuses: readonly CcConnectPlatformStatus[]): void {
    this.statuses.clear();
    for (const status of statuses) {
      this.statuses.set(status.accountId, {
        connected: status.state === 'ready',
        lastError:
          status.state === 'unavailable'
            ? status.lastError || 'Channel platform is unavailable'
            : null,
        startedAt: parseTimestamp(status.startedAt),
        lastInboundAt: parseTimestamp(status.lastInboundAt),
        lastOutboundAt: parseTimestamp(status.lastOutboundAt),
      });
    }
  }

  markUnavailable(accountId: string, error: unknown): void {
    this.statuses.set(accountId, {
      ...EMPTY_STATUS,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  delete(accountId: string): void {
    this.statuses.delete(accountId);
  }

  clear(): void {
    this.statuses.clear();
  }

  get(accountId: string): CcConnectAccountRuntimeStatus {
    return this.statuses.get(accountId) ?? { ...EMPTY_STATUS };
  }
}

function parseTimestamp(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}
