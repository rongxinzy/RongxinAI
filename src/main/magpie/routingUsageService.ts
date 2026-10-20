import {
  MagpieUsagePeriod,
  type MagpieRoutingGroupSaveInput,
  type MagpieUsagePeriod as MagpieUsagePeriodType,
} from '../../shared/magpie/routingUsage';
import { formatMagpieManagementError } from './managementErrors';
import type { MagpieRoutingGateway } from './magpieRoutingGateway';
import {
  mergeRoutingGroupSaveBody,
  projectRoutingGroups,
  projectUsageBudget,
  projectUsageQuotas,
  projectUsageRequestPage,
  projectUsageSummary,
} from './projectRoutingUsage';

const USAGE_READ_TIMEOUT_MS = 10_000;
const USAGE_QUOTA_TIMEOUT_MS = 15_000;

async function managementValue(
  gateway: MagpieRoutingGateway,
  route: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<unknown> {
  const response = await gateway.managementRequest(route, init, timeoutMs);
  const text = await response.text();
  if (!response.ok)
    throw new Error(formatMagpieManagementError(response.status, response.statusText, text));
  if (text.length > 1024 * 1024) throw new Error('Management response exceeds size limit');
  return text.length ? JSON.parse(text) : null;
}

async function managementJson(
  gateway: MagpieRoutingGateway,
  route: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  const body = await managementValue(gateway, route, init, timeoutMs);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid management response');
  }
  return body as Record<string, unknown>;
}

export class MagpieRoutingUsageService {
  constructor(private readonly gateway: MagpieRoutingGateway) {}

  async routingGroups() {
    await this.gateway.ensureRunning();
    return projectRoutingGroups(await managementJson(this.gateway, '/api/groups'));
  }

  async saveRoutingGroup(input: MagpieRoutingGroupSaveInput) {
    if (!input || typeof input !== 'object') throw new Error('Invalid routing group');
    await this.gateway.ensureRunning();
    const state = await managementJson(this.gateway, '/api/groups');
    const body = mergeRoutingGroupSaveBody(state, input);
    return projectRoutingGroups(
      await managementJson(this.gateway, '/api/groups/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  async deleteRoutingGroup(id: string) {
    if (typeof id !== 'string' || !id.trim() || id.length > 120) {
      throw new Error('Invalid routing group id');
    }
    await this.gateway.ensureRunning();
    return projectRoutingGroups(
      await managementJson(this.gateway, '/api/groups/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id.trim() }),
      }),
    );
  }

  async arrangeRoutingGroups(order: string[]) {
    if (!Array.isArray(order) || order.length > 500) throw new Error('Invalid group order');
    const sanitized = order
      .filter(item => typeof item === 'string' && item.length <= 120)
      .slice(0, 500);
    await this.gateway.ensureRunning();
    return projectRoutingGroups(
      await managementJson(this.gateway, '/api/groups/arrange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: sanitized }),
      }),
    );
  }

  async usageSummary(period: MagpieUsagePeriodType) {
    if (!Object.values(MagpieUsagePeriod).includes(period)) {
      throw new Error('Invalid usage period');
    }
    await this.gateway.ensureRunning();
    const query = new URLSearchParams({ period });
    return projectUsageSummary(
      await managementJson(
        this.gateway,
        `/api/usage?${query.toString()}`,
        {},
        USAGE_READ_TIMEOUT_MS,
      ),
      period,
    );
  }

  async usageRequests(period: MagpieUsagePeriodType, offset: number, limit: number) {
    if (!Object.values(MagpieUsagePeriod).includes(period)) {
      throw new Error('Invalid usage period');
    }
    const safeOffset = Math.max(0, Math.min(Math.floor(offset), 1_000_000));
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    await this.gateway.ensureRunning();
    const query = new URLSearchParams({
      period,
      offset: String(safeOffset),
      limit: String(safeLimit),
    });
    return projectUsageRequestPage(
      await managementJson(
        this.gateway,
        `/api/usage/requests?${query.toString()}`,
        {},
        USAGE_READ_TIMEOUT_MS,
      ),
      period,
    );
  }

  async usageQuotas(asked = false) {
    await this.gateway.ensureRunning();
    const query = asked ? '?asked=1' : '';
    return projectUsageQuotas(
      await managementValue(this.gateway, `/api/usage/quotas${query}`, {}, USAGE_QUOTA_TIMEOUT_MS),
    );
  }

  async usageBudget() {
    await this.gateway.ensureRunning();
    return projectUsageBudget(await managementJson(this.gateway, '/api/settings'));
  }
}
