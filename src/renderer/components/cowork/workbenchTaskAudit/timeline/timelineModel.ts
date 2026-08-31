import {
  WorkbenchRunEventType,
  type WorkbenchApproval,
  type WorkbenchArtifact,
  type WorkbenchRun,
  type WorkbenchRunEvent,
  type WorkbenchTaskDetail,
} from '../../../../../shared/workbenchTask';

export type TimelineEntry =
  | { kind: 'event'; id: string; event: WorkbenchRunEvent; createdAt: number }
  | {
      kind: 'eventCluster';
      id: string;
      type: WorkbenchRunEventType;
      events: WorkbenchRunEvent[];
      createdAt: number;
    }
  | { kind: 'approval'; id: string; approval: WorkbenchApproval; createdAt: number }
  | { kind: 'artifact'; id: string; artifact: WorkbenchArtifact; createdAt: number };

export interface TimelineChapter {
  run: WorkbenchRun;
  entries: TimelineEntry[];
}

export const CLUSTER_THRESHOLD = 3;

/** Low-signal event types that collapse into a cluster when they repeat consecutively. */
export const MINOR_EVENT_TYPES: ReadonlySet<WorkbenchRunEventType> = new Set([
  WorkbenchRunEventType.ToolRead,
  WorkbenchRunEventType.HarnessProfiled,
  WorkbenchRunEventType.HarnessActivation,
  WorkbenchRunEventType.HarnessFailure,
  WorkbenchRunEventType.HarnessQualityMeasured,
]);

const compareEvents = (a: WorkbenchRunEvent, b: WorkbenchRunEvent): number =>
  a.createdAt - b.createdAt || a.sequence - b.sequence;

/** Collapse runs of 3+ consecutive same-type minor events into a single cluster entry. */
const clusterEvents = (events: WorkbenchRunEvent[]): TimelineEntry[] => {
  const entries: TimelineEntry[] = [];
  let index = 0;
  while (index < events.length) {
    const event = events[index];
    if (!MINOR_EVENT_TYPES.has(event.type)) {
      entries.push({ kind: 'event', id: event.id, event, createdAt: event.createdAt });
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < events.length && events[end].type === event.type) end += 1;
    const group = events.slice(index, end);
    if (group.length >= CLUSTER_THRESHOLD) {
      entries.push({
        kind: 'eventCluster',
        id: `cluster-${event.id}`,
        type: event.type,
        events: group,
        createdAt: event.createdAt,
      });
    } else {
      for (const item of group) {
        entries.push({ kind: 'event', id: item.id, event: item, createdAt: item.createdAt });
      }
    }
    index = end;
  }
  return entries;
};

export function buildTimelineChapters(detail: WorkbenchTaskDetail): TimelineChapter[] {
  const runs = [...detail.runs].sort((a, b) => a.attempt - b.attempt);
  return runs.map(run => {
    const eventEntries = clusterEvents(
      detail.events.filter(event => event.runId === run.id).sort(compareEvents),
    );
    const approvalEntries: TimelineEntry[] = detail.approvals
      .filter(approval => approval.runId === run.id)
      .map(approval => ({
        kind: 'approval',
        id: approval.id,
        approval,
        createdAt: approval.createdAt,
      }));
    const artifactEntries: TimelineEntry[] = detail.artifacts
      .filter(artifact => artifact.runId === run.id)
      .map(artifact => ({
        kind: 'artifact',
        id: artifact.id,
        artifact,
        createdAt: artifact.createdAt,
      }));
    // Array.prototype.sort is stable, so equal timestamps keep the
    // events -> approvals -> artifacts reading order.
    const entries = [...eventEntries, ...approvalEntries, ...artifactEntries].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    return { run, entries };
  });
}

/** Wall-clock time of day, HH:MM:SS in 24-hour format. */
export const formatTimeOfDay = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString(undefined, { hour12: false });

/** Compact duration label ('45s', '2:03', '1h 02m'); null when either end is missing. */
export const formatDuration = (
  startedAt: number | null,
  endedAt: number | null,
): string | null => {
  if (startedAt === null || endedAt === null) return null;
  const totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
};
