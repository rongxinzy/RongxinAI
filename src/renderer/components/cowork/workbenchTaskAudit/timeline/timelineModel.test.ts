import { expect, test } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  type WorkbenchApproval,
  type WorkbenchArtifact,
  type WorkbenchRun,
  type WorkbenchRunEvent,
  type WorkbenchTaskDetail,
} from '../../../../../shared/workbenchTask';
import {
  CLUSTER_THRESHOLD,
  buildTimelineChapters,
  formatDuration,
  formatTimeOfDay,
} from './timelineModel';

const createRun = (id: string, attempt: number): WorkbenchRun => ({
  id,
  taskId: 'task-1',
  attempt,
  status: WorkbenchRunStatus.Succeeded,
  trigger: WorkbenchRunTrigger.Message,
  startedAt: 1000,
  endedAt: 2000,
  context: null,
  verificationResult: null,
  failure: null,
  createdAt: 1000,
  updatedAt: 2000,
});

const createEvent = (
  id: string,
  runId: string,
  type: WorkbenchRunEventType,
  createdAt: number,
  sequence: number,
): WorkbenchRunEvent => ({ id, runId, sequence, type, payload: {}, createdAt });

const createApproval = (id: string, runId: string, createdAt: number): WorkbenchApproval => ({
  id,
  taskId: 'task-1',
  runId,
  toolCallId: `call-${id}`,
  toolName: 'write',
  riskLevel: WorkbenchApprovalRiskLevel.Reversible,
  decision: WorkbenchApprovalDecision.Approved,
  decisionSource: null,
  effectStatus: WorkbenchApprovalEffectStatus.Succeeded,
  idempotencyKey: `key-${id}`,
  request: {},
  result: null,
  createdAt,
  updatedAt: createdAt,
  decidedAt: createdAt,
});

const createArtifact = (id: string, runId: string, createdAt: number): WorkbenchArtifact => ({
  id,
  taskId: 'task-1',
  runId,
  kind: WorkbenchArtifactKind.File,
  mimeType: 'text/plain',
  reference: `${id}.txt`,
  contentHash: `hash-${id}`,
  provenance: WorkbenchArtifactProvenance.Workspace,
  verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
  metadata: {},
  createdAt,
  updatedAt: createdAt,
});

const createDetail = (overrides: Partial<WorkbenchTaskDetail> = {}): WorkbenchTaskDetail => ({
  task: {
    id: 'task-1',
    sessionId: 'session-1',
    goal: 'Audit a task',
    status: WorkbenchTaskStatus.Completed,
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: false },
    activeRunId: null,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
  },
  runs: [],
  events: [],
  artifacts: [],
  approvals: [],
  ...overrides,
});

test('orders chapters by run attempt ascending', () => {
  const detail = createDetail({ runs: [createRun('run-3', 3), createRun('run-1', 1), createRun('run-2', 2)] });

  const chapters = buildTimelineChapters(detail);

  expect(chapters.map(chapter => chapter.run.id)).toEqual(['run-1', 'run-2', 'run-3']);
});

test('orders entries by createdAt with events tie-broken by sequence', () => {
  const detail = createDetail({
    runs: [createRun('run-1', 1)],
    events: [
      createEvent('event-b', 'run-1', WorkbenchRunEventType.RunStarted, 100, 2),
      createEvent('event-a', 'run-1', WorkbenchRunEventType.RunCreated, 100, 1),
      createEvent('event-c', 'run-1', WorkbenchRunEventType.VerificationStarted, 50, 3),
    ],
    approvals: [createApproval('approval-1', 'run-1', 150)],
    artifacts: [createArtifact('artifact-1', 'run-1', 120)],
  });

  const [chapter] = buildTimelineChapters(detail);

  expect(chapter.entries.map(entry => entry.id)).toEqual([
    'event-c',
    'event-a',
    'event-b',
    'artifact-1',
    'approval-1',
  ]);
});

test('keeps two consecutive minor events unclustered', () => {
  const detail = createDetail({
    runs: [createRun('run-1', 1)],
    events: [
      createEvent('e1', 'run-1', WorkbenchRunEventType.ToolRead, 1, 1),
      createEvent('e2', 'run-1', WorkbenchRunEventType.ToolRead, 2, 2),
    ],
  });

  const [chapter] = buildTimelineChapters(detail);

  expect(chapter.entries).toHaveLength(2);
  expect(chapter.entries.every(entry => entry.kind === 'event')).toBe(true);
});

test('collapses three consecutive minor events into one cluster', () => {
  const detail = createDetail({
    runs: [createRun('run-1', 1)],
    events: [
      createEvent('e1', 'run-1', WorkbenchRunEventType.ToolRead, 1, 1),
      createEvent('e2', 'run-1', WorkbenchRunEventType.ToolRead, 2, 2),
      createEvent('e3', 'run-1', WorkbenchRunEventType.ToolRead, 3, 3),
    ],
  });

  const [chapter] = buildTimelineChapters(detail);

  expect(CLUSTER_THRESHOLD).toBe(3);
  expect(chapter.entries).toHaveLength(1);
  const cluster = chapter.entries[0];
  expect(cluster.kind).toBe('eventCluster');
  if (cluster.kind === 'eventCluster') {
    expect(cluster.type).toBe(WorkbenchRunEventType.ToolRead);
    expect(cluster.events.map(event => event.id)).toEqual(['e1', 'e2', 'e3']);
    expect(cluster.createdAt).toBe(1);
  }
});

test('never clusters lifecycle events, even when consecutive', () => {
  const detail = createDetail({
    runs: [createRun('run-1', 1)],
    events: [
      createEvent('e1', 'run-1', WorkbenchRunEventType.RunStarted, 1, 1),
      createEvent('e2', 'run-1', WorkbenchRunEventType.RunStarted, 2, 2),
      createEvent('e3', 'run-1', WorkbenchRunEventType.RunStarted, 3, 3),
    ],
  });

  const [chapter] = buildTimelineChapters(detail);

  expect(chapter.entries).toHaveLength(3);
  expect(chapter.entries.every(entry => entry.kind === 'event')).toBe(true);
});

test('does not merge same-type minor events separated by another event', () => {
  const detail = createDetail({
    runs: [createRun('run-1', 1)],
    events: [
      createEvent('e1', 'run-1', WorkbenchRunEventType.ToolRead, 1, 1),
      createEvent('e2', 'run-1', WorkbenchRunEventType.ToolRead, 2, 2),
      createEvent('e3', 'run-1', WorkbenchRunEventType.RunStarted, 3, 3),
      createEvent('e4', 'run-1', WorkbenchRunEventType.ToolRead, 4, 4),
      createEvent('e5', 'run-1', WorkbenchRunEventType.ToolRead, 5, 5),
    ],
  });

  const [chapter] = buildTimelineChapters(detail);

  expect(chapter.entries).toHaveLength(5);
  expect(chapter.entries.every(entry => entry.kind === 'event')).toBe(true);
});

test('scopes entries to their owning run chapter', () => {
  const detail = createDetail({
    runs: [createRun('run-1', 1), createRun('run-2', 2)],
    events: [createEvent('e1', 'run-2', WorkbenchRunEventType.RunStarted, 1, 1)],
    approvals: [createApproval('a1', 'run-1', 1)],
    artifacts: [createArtifact('f1', 'run-2', 2)],
  });

  const chapters = buildTimelineChapters(detail);

  expect(chapters[0].entries.map(entry => entry.id)).toEqual(['a1']);
  expect(chapters[1].entries.map(entry => entry.id)).toEqual(['e1', 'f1']);
});

test('formats durations in a compact locale-neutral style', () => {
  expect(formatDuration(0, 45_000)).toBe('45s');
  expect(formatDuration(0, 123_000)).toBe('2:03');
  expect(formatDuration(0, 3_720_000)).toBe('1h 02m');
  expect(formatDuration(0, null)).toBeNull();
  expect(formatDuration(null, 5_000)).toBeNull();
});

test('formats time of day as a 24-hour HH:MM:SS clock', () => {
  const timestamp = Date.UTC(2026, 7, 20, 14, 5, 9);

  expect(formatTimeOfDay(timestamp)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
});
