import { expect, test } from 'vitest';

import {
  WorkbenchContractKind,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  type WorkbenchRun,
  type WorkbenchTaskDetail,
} from '../../../../shared/workbenchTask';
import { formatJson, getProjectedRun, getRunAttempt } from './utils';

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
