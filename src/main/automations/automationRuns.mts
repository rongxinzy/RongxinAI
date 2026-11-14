import type { Conversation, Cursor } from '@earendil-works/pi-durable';
import type { RunFilter, ScheduledTaskRunWithName } from '../../scheduledTask/types.js';
import { AutomationEntry } from './automationState.mjs';
import { automationContext } from './automationStorage.mjs';

export async function readAutomationRuns(
  conversation: Conversation,
  limit = Infinity,
  filter?: RunFilter,
): Promise<ScheduledTaskRunWithName[]> {
  const result = new Map<string, ScheduledTaskRunWithName>();
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries({}, 256, cursor, automationContext);
    for (const entry of page.items) {
      if (entry.kind !== AutomationEntry.Run) continue;
      const run = entry.data as unknown as ScheduledTaskRunWithName;
      if (!result.has(run.id)) result.set(run.id, run);
    }
    cursor = page.next;
    if (filterAutomationRuns([...result.values()], filter).length >= limit) break;
  } while (cursor !== undefined);
  return filterAutomationRuns([...result.values()], filter)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function filterAutomationRuns<T extends ScheduledTaskRunWithName>(
  runs: T[],
  filter?: RunFilter,
): T[] {
  const start = filter?.startDate ? Date.parse(`${filter.startDate}T00:00:00`) : NaN;
  const end = filter?.endDate ? Date.parse(`${filter.endDate}T23:59:59.999`) : NaN;
  return runs.filter(run => {
    if (filter?.status && run.status !== filter.status) return false;
    const time = Date.parse(run.startedAt);
    return (!Number.isFinite(start) || time >= start) && (!Number.isFinite(end) || time <= end);
  });
}
