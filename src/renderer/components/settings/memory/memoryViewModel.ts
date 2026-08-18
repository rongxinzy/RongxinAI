import {
  MemoryDeliveryStatus,
  MemoryLifecycleStatus,
  MemoryScope,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import {
  ManagedMemoryScopeFilter,
  ManagedMemoryStatusFilter,
  ManagedMemoryView,
  type ManagedMemoryScopeFilter as ManagedMemoryScopeFilterValue,
  type ManagedMemoryStatusFilter as ManagedMemoryStatusFilterValue,
  type ManagedMemoryView as ManagedMemoryViewValue,
} from './constants';

export interface ManagedMemoryFilters {
  view: ManagedMemoryViewValue;
  scope: ManagedMemoryScopeFilterValue;
  status: ManagedMemoryStatusFilterValue;
  query: string;
}

export interface ManagedMemoryCounts {
  longTerm: number;
  session: number;
}

export function countManagedMemories(records: ManagedMemoryRecord[]): ManagedMemoryCounts {
  return records.reduce<ManagedMemoryCounts>(
    (counts, record) => {
      if (record.scope === MemoryScope.Session) counts.session += 1;
      else counts.longTerm += 1;
      return counts;
    },
    { longTerm: 0, session: 0 },
  );
}

export function collectMemorySourceSessionIds(records: ManagedMemoryRecord[]): string[] {
  const sessionIds = new Set<string>();
  for (const record of records) {
    if (record.sessionId.trim()) sessionIds.add(record.sessionId.trim());
    if (record.promotionSourceSessionId?.trim()) {
      sessionIds.add(record.promotionSourceSessionId.trim());
    }
  }
  return Array.from(sessionIds);
}

export function filterAndSortManagedMemories(
  records: ManagedMemoryRecord[],
  filters: ManagedMemoryFilters,
): ManagedMemoryRecord[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  return records
    .filter(record => matchesView(record, filters.view))
    .filter(record => matchesScope(record, filters.scope, filters.view))
    .filter(record => matchesStatus(record, filters.status))
    .filter(record => matchesQuery(record, normalizedQuery))
    .sort(compareManagedMemories);
}

function matchesView(record: ManagedMemoryRecord, view: ManagedMemoryViewValue): boolean {
  return view === ManagedMemoryView.Session
    ? record.scope === MemoryScope.Session
    : record.scope !== MemoryScope.Session;
}

function matchesScope(
  record: ManagedMemoryRecord,
  scope: ManagedMemoryScopeFilterValue,
  view: ManagedMemoryViewValue,
): boolean {
  if (view === ManagedMemoryView.Session || scope === ManagedMemoryScopeFilter.All) return true;
  return record.scope === scope;
}

function matchesStatus(
  record: ManagedMemoryRecord,
  status: ManagedMemoryStatusFilterValue,
): boolean {
  if (status === ManagedMemoryStatusFilter.All) return true;
  if (status === ManagedMemoryStatusFilter.Inactive) {
    return (
      record.status !== MemoryLifecycleStatus.Active &&
      record.status !== MemoryLifecycleStatus.NeedsReview
    );
  }
  return record.status === status;
}

function matchesQuery(record: ManagedMemoryRecord, query: string): boolean {
  if (!query) return true;
  return [
    record.title,
    record.content,
    record.sessionId,
    record.taskId,
    record.runId,
    record.artifactId,
  ].some(value => value?.toLocaleLowerCase().includes(query));
}

function compareManagedMemories(left: ManagedMemoryRecord, right: ManagedMemoryRecord): number {
  const deliveryDifference = deliveryPriority(left) - deliveryPriority(right);
  if (deliveryDifference !== 0) return deliveryDifference;
  const lifecycleDifference = lifecyclePriority(left) - lifecyclePriority(right);
  if (lifecycleDifference !== 0) return lifecycleDifference;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function deliveryPriority(record: ManagedMemoryRecord): number {
  return record.deliveryStatus === MemoryDeliveryStatus.Pending ||
    record.deliveryStatus === MemoryDeliveryStatus.Failed
    ? 0
    : 1;
}

function lifecyclePriority(record: ManagedMemoryRecord): number {
  if (record.status === MemoryLifecycleStatus.NeedsReview) return 0;
  if (record.status === MemoryLifecycleStatus.Active) return 1;
  return 2;
}
