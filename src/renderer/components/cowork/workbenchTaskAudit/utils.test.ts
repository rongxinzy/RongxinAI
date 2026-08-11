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
  type WorkbenchRun,
  type WorkbenchTaskDetail,
} from '../../../../shared/workbenchTask';
import { WorkbenchTaskRunFilter } from './constants';
import { filterTaskDetailByRun, formatJson, getProjectedRun, getRunAttempt } from './utils';

const createRun = (id: string, attempt: number): WorkbenchRun => ({
  id,
  taskId: 'task-1',
  attempt,
  status: WorkbenchRunStatus.Succeeded,
  trigger: WorkbenchRunTrigger.Message,
  startedAt: 1,
  endedAt: 2,
  verificationResult: null,
  failure: null,
  createdAt: 1,
  updatedAt: 2,
});

const createDetail = (runs: WorkbenchRun[], activeRunId: string | null): WorkbenchTaskDetail => ({
  task: {
    id: 'task-1',
    sessionId: 'session-1',
    goal: 'Audit a task',
    status: WorkbenchTaskStatus.Completed,
    contract: {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: false,
    },
    activeRunId,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
  },
  runs,
  events: [],
  artifacts: [],
  approvals: [],
});

test('selects the active run for the artifact projection', () => {
  const first = createRun('run-1', 1);
  const second = createRun('run-2', 2);

  expect(getProjectedRun(createDetail([second, first], first.id))).toBe(first);
  expect(getProjectedRun(createDetail([second, first], null))).toBe(second);
  expect(getProjectedRun(null)).toBeNull();
});

test('attributes audit records to their run attempt', () => {
  const runs = [createRun('run-2', 2), createRun('run-1', 1)];

  expect(getRunAttempt(runs, 'run-1')).toBe(1);
  expect(getRunAttempt(runs, 'missing')).toBeNull();
});

test('formats structured audit data for readable disclosure', () => {
  expect(formatJson({ command: 'build', success: true })).toBe(
    '{\n  "command": "build",\n  "success": true\n}',
  );
  expect(formatJson(null)).toBe('-');
});

test('filters every audit collection by run', () => {
  const first = createRun('run-1', 1);
  const second = createRun('run-2', 2);
  const detail = createDetail([second, first], second.id);
  detail.events = [first, second].map(run => ({
    id: `event-${run.id}`,
    runId: run.id,
    sequence: 1,
    type: WorkbenchRunEventType.RunStarted,
    payload: {},
    createdAt: 1,
  }));
  detail.artifacts = [first, second].map(run => ({
    id: `artifact-${run.id}`,
    taskId: detail.task.id,
    runId: run.id,
    kind: WorkbenchArtifactKind.File,
    mimeType: 'text/plain',
    reference: `${run.id}.txt`,
    contentHash: run.id,
    provenance: WorkbenchArtifactProvenance.Workspace,
    verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  }));
  detail.approvals = [first, second].map(run => ({
    id: `approval-${run.id}`,
    taskId: detail.task.id,
    runId: run.id,
    toolCallId: run.id,
    toolName: 'write',
    riskLevel: WorkbenchApprovalRiskLevel.Reversible,
    decision: WorkbenchApprovalDecision.Approved,
    decisionSource: null,
    effectStatus: WorkbenchApprovalEffectStatus.Succeeded,
    idempotencyKey: run.id,
    request: {},
    result: null,
    createdAt: 1,
    updatedAt: 1,
    decidedAt: 1,
  }));

  const filtered = filterTaskDetailByRun(detail, first.id);
  expect(filtered.runs.map(run => run.id)).toEqual([first.id]);
  expect(filtered.events.map(event => event.runId)).toEqual([first.id]);
  expect(filtered.artifacts.map(artifact => artifact.runId)).toEqual([first.id]);
  expect(filtered.approvals.map(approval => approval.runId)).toEqual([first.id]);
  expect(filterTaskDetailByRun(detail, WorkbenchTaskRunFilter.All)).toBe(detail);
});
