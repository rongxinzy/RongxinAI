import {
  MagpieUsagePeriod,
  type MagpieRoutingGroup,
  type MagpieRoutingGroupSaveInput,
  type MagpieRoutingMemberInfo,
  type MagpieRoutingModelRef,
  type MagpieRoutingState,
  type MagpieQuotaWindow,
  type MagpieSubscriptionQuota,
  type MagpieUsageBudget,
  type MagpieUsageRequestPage,
  type MagpieUsageRequestRow,
  type MagpieUsageSummary,
  type MagpieUsageTotals,
} from '../../shared/magpie/routingUsage';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' && value.length <= max ? value : '';
}

function bool(value: unknown): boolean {
  return value === true;
}

function int(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
    ? Math.floor(value)
    : 0;
}

function float(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown, limit = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.length <= 500)
    .slice(0, limit);
}

function projectTotals(raw: Record<string, unknown>): MagpieUsageTotals {
  return {
    calls: int(raw.calls),
    errors: int(raw.errors),
    input: int(raw.input, 1_000_000_000),
    output: int(raw.output, 1_000_000_000),
    cost: float(raw.cost),
    unpriced: int(raw.unpriced),
  };
}

function projectMemberInfo(value: unknown): MagpieRoutingMemberInfo | null {
  const item = record(value);
  const id = text(item.id, 500);
  if (!id) return null;
  return {
    id,
    ready: bool(item.ready),
    ...(text(item.provider, 120) ? { provider: text(item.provider, 120) } : {}),
    ...(text(item.name, 200) ? { name: text(item.name, 200) } : {}),
    ...(text(item.model, 200) ? { model: text(item.model, 200) } : {}),
    ...(bool(item.group) ? { group: true } : {}),
    ...(bool(item.providerOff) ? { providerOff: true } : {}),
  };
}

function projectGroup(value: unknown): MagpieRoutingGroup | null {
  const item = record(value);
  const id = text(item.id, 120);
  const name = text(item.name, 200);
  if (!id || !name) return null;
  const memberInfo = Array.isArray(item.memberInfo)
    ? item.memberInfo
        .map(projectMemberInfo)
        .filter((m): m is MagpieRoutingMemberInfo => m !== null)
        .slice(0, 200)
    : [];
  return {
    id,
    name,
    members: strings(item.members, 200),
    ...(text(item.routing, 40) ? { routing: text(item.routing, 40) } : {}),
    ...(text(item.affinity, 40) ? { affinity: text(item.affinity, 40) } : {}),
    ...(Array.isArray(item.off) ? { off: strings(item.off, 200) } : {}),
    ready: bool(item.ready),
    memberInfo,
  };
}

function projectModelRef(value: unknown): MagpieRoutingModelRef | null {
  const item = record(value);
  const id = text(item.id, 500);
  const name = text(item.name, 200);
  const provider = text(item.provider, 120);
  const providerName = text(item.providerName, 200) || text(item.pName, 200);
  if (!id || !name || !provider) return null;
  return { id, name, provider, providerName: providerName || provider };
}

export function projectRoutingGroups(raw: unknown): MagpieRoutingState {
  const body = record(raw);
  const groups = Array.isArray(body.groups)
    ? body.groups
        .map(projectGroup)
        .filter((g): g is MagpieRoutingGroup => g !== null)
        .slice(0, 500)
    : [];
  const models = Array.isArray(body.models)
    ? body.models
        .map(projectModelRef)
        .filter((m): m is MagpieRoutingModelRef => m !== null)
        .slice(0, 5000)
    : [];
  return { groups, models };
}

function sanitizeMembers(members: string[]): string[] {
  return members.filter(m => typeof m === 'string' && m.length <= 500).slice(0, 200);
}

function buildRoutingGroupSaveBody(
  input: MagpieRoutingGroupSaveInput,
): Record<string, unknown> {
  const id = input.id.trim();
  const name = input.name.trim();
  if (!id || !name) throw new Error('Group id and name are required');
  const payload: Record<string, unknown> = {
    id,
    name,
    members: sanitizeMembers(input.members),
  };
  if (input.routing !== undefined) payload.routing = input.routing;
  if (input.affinity) payload.affinity = input.affinity;
  if (input.off?.length) payload.off = input.off.slice(0, 200);
  const from = input.renameFrom?.trim();
  if (from) payload.from = from;
  return payload;
}

/** Preserve upstream-only fields (match, rules, weights, …) when updating a group. */
export function mergeRoutingGroupSaveBody(
  groupsState: Record<string, unknown>,
  input: MagpieRoutingGroupSaveInput,
): Record<string, unknown> {
  const sourceId = (input.renameFrom?.trim() || input.id).trim();
  const groups = Array.isArray(groupsState.groups) ? groupsState.groups : [];
  const existing = groups.find((entry: unknown) => text(record(entry).id, 120) === sourceId);
  if (!existing || typeof existing !== 'object') {
    return buildRoutingGroupSaveBody(input);
  }
  const payload: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  payload.id = input.id.trim();
  payload.name = input.name.trim();
  payload.members = sanitizeMembers(input.members);
  if (input.routing !== undefined) payload.routing = input.routing;
  if (input.affinity !== undefined) payload.affinity = input.affinity;
  if (input.off !== undefined) payload.off = input.off.slice(0, 200);
  const from = input.renameFrom?.trim();
  if (from && from !== input.id.trim()) payload.from = from;
  return payload;
}

export function projectUsageSummary(raw: unknown, period: MagpieUsagePeriod): MagpieUsageSummary {
  const body = record(raw);
  const totals = projectTotals(body);
  return {
    period,
    ...totals,
  };
}

export function projectUsageRequestPage(
  raw: unknown,
  period: MagpieUsagePeriod,
): MagpieUsageRequestPage {
  const body = record(raw);
  const rows: MagpieUsageRequestRow[] = Array.isArray(body.rows)
    ? body.rows
        .flatMap((row: unknown) => {
          const item = record(row);
          const time = text(item.t) || text(item.time);
          if (!time) return [];
          const status = int(item.status);
          const vendorError = text(item.err, 2000) || text(item.error, 500);
          const cost = item.cost;
          return [
            {
              time,
              agentName: text(item.agentName, 200) || text(item.agent, 120) || '—',
              providerName: text(item.providerName, 200) || text(item.provider, 120) || '—',
              model: text(item.model, 200) || text(item.req, 200) || '—',
              input: int(item.in ?? item.input),
              output: int(item.out ?? item.output),
              ...(typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {}),
              failed: status >= 400 || vendorError.length > 0,
            },
          ];
        })
        .slice(0, 500)
    : [];
  const totals = projectTotals(body);
  return {
    period,
    rows,
    offset: int(body.offset),
    total: int(body.total),
    totals,
  };
}

function projectQuotaWindow(value: unknown): MagpieQuotaWindow | null {
  const item = record(value);
  const name = text(item.name, 120);
  if (!name) return null;
  const window: MagpieQuotaWindow = { name };
  if (typeof item.used === 'number' && Number.isFinite(item.used)) window.used = item.used;
  if (item.unlimited === true) window.unlimited = true;
  if (typeof item.resetsAt === 'string') window.resetsAt = item.resetsAt;
  return window;
}

export function projectUsageQuotas(raw: unknown): MagpieSubscriptionQuota[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((entry: unknown) => {
      const item = record(entry);
      const provider = text(item.provider, 120);
      const name = text(item.name, 200);
      if (!provider || !name) return [];
      const windows = Array.isArray(item.windows)
        ? item.windows
            .map(projectQuotaWindow)
            .filter((w): w is MagpieQuotaWindow => w !== null)
            .slice(0, 20)
        : [];
      return [
        {
          provider,
          name,
          ...(text(item.plan, 120) ? { plan: text(item.plan, 120) } : {}),
          ...(text(item.user, 200) ? { user: text(item.user, 200) } : {}),
          windows,
          ...(text(item.balance, 120) ? { balance: text(item.balance, 120) } : {}),
          ...(text(item.error, 500) ? { error: text(item.error, 500) } : {}),
        },
      ];
    })
    .slice(0, 200);
}

export function projectUsageBudget(raw: unknown): MagpieUsageBudget {
  const body = record(raw);
  const usageAlert = int(body.usageAlert, 100);
  const balanceAlert = float(body.balanceAlert);
  return {
    usageAlertPercent: usageAlert,
    balanceAlert,
  };
}
