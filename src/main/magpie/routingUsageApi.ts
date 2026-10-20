import {
  MagpieUsagePeriod,
  type MagpieRoutingGroupSaveInput,
  type MagpieUsagePeriod as MagpieUsagePeriodType,
} from '../../shared/magpie/routingUsage';
import { formatMagpieManagementError } from './managementErrors';
import { magpieManagementRequest } from './managementTransport';
import type { MagpieManager } from './manager';
import {
  buildRoutingGroupSaveBody,
  projectRoutingGroups,
  projectUsageBudget,
  projectUsageQuotas,
  projectUsageRequestPage,
  projectUsageSummary,
} from './projectRoutingUsage';

async function managementValue(
  manager: MagpieManager,
  route: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await magpieManagementRequest(manager, route, init);
  const text = await response.text();
  if (!response.ok)
    throw new Error(formatMagpieManagementError(response.status, response.statusText, text));
  if (text.length > 1024 * 1024) throw new Error('Management response exceeds size limit');
  return JSON.parse(text);
}

async function managementJson(
  manager: MagpieManager,
  route: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const body = await managementValue(manager, route, init);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid management response');
  }
  return body as Record<string, unknown>;
}

export async function routingGroups(manager: MagpieManager) {
  await manager.ensureRunning();
  return projectRoutingGroups(await managementJson(manager, '/api/groups'));
}

export async function saveRoutingGroup(manager: MagpieManager, input: MagpieRoutingGroupSaveInput) {
  if (!input || typeof input !== 'object') throw new Error('Invalid routing group');
  await manager.ensureRunning();
  const body = buildRoutingGroupSaveBody(input);
  return projectRoutingGroups(
    await managementJson(manager, '/api/groups/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteRoutingGroup(manager: MagpieManager, id: string) {
  if (typeof id !== 'string' || !id.trim() || id.length > 120) {
    throw new Error('Invalid routing group id');
  }
  await manager.ensureRunning();
  return projectRoutingGroups(
    await managementJson(manager, '/api/groups/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id.trim() }),
    }),
  );
}

export async function arrangeRoutingGroups(manager: MagpieManager, order: string[]) {
  if (!Array.isArray(order) || order.length > 500) throw new Error('Invalid group order');
  const sanitized = order
    .filter(item => typeof item === 'string' && item.length <= 120)
    .slice(0, 500);
  await manager.ensureRunning();
  return projectRoutingGroups(
    await managementJson(manager, '/api/groups/arrange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: sanitized }),
    }),
  );
}

export async function usageSummary(manager: MagpieManager, period: MagpieUsagePeriodType) {
  if (!Object.values(MagpieUsagePeriod).includes(period)) {
    throw new Error('Invalid usage period');
  }
  await manager.ensureRunning();
  const query = new URLSearchParams({ period });
  return projectUsageSummary(
    await managementJson(manager, `/api/usage?${query.toString()}`),
    period,
  );
}

export async function usageRequests(
  manager: MagpieManager,
  period: MagpieUsagePeriodType,
  offset: number,
  limit: number,
) {
  if (!Object.values(MagpieUsagePeriod).includes(period)) {
    throw new Error('Invalid usage period');
  }
  const safeOffset = Math.max(0, Math.min(Math.floor(offset), 1_000_000));
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  await manager.ensureRunning();
  const query = new URLSearchParams({
    period,
    offset: String(safeOffset),
    limit: String(safeLimit),
  });
  return projectUsageRequestPage(
    await managementJson(manager, `/api/usage/requests?${query.toString()}`),
    period,
  );
}

export async function usageQuotas(manager: MagpieManager, asked = false) {
  await manager.ensureRunning();
  const query = asked ? '?asked=1' : '';
  return projectUsageQuotas(await managementValue(manager, `/api/usage/quotas${query}`));
}

export async function usageBudget(manager: MagpieManager) {
  await manager.ensureRunning();
  return projectUsageBudget(await managementJson(manager, '/api/settings'));
}
