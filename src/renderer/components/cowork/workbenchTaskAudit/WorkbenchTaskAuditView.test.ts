// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

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
  type WorkbenchTask,
  type WorkbenchTaskDetail,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { WorkbenchTaskAuditView } from './WorkbenchTaskAuditView';
import { formatTimestamp, statusLabel } from './utils';

const createTask = (
  id: string,
  goal: string,
  status: WorkbenchTask['status'],
  createdAt: number,
): WorkbenchTask => ({
  id,
  sessionId: 'session-1',
  goal,
  status,
  contract: {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: false,
  },
  activeRunId: null,
  createdAt,
  updatedAt: createdAt,
  completedAt: status === WorkbenchTaskStatus.Completed ? createdAt : null,
});

const createRun = (
  id: string,
  attempt: number,
  status: WorkbenchRun['status'],
): WorkbenchRun => ({
  id,
  taskId: 'task-1',
  attempt,
  status,
  trigger: WorkbenchRunTrigger.Message,
  startedAt: Date.UTC(2026, 7, 20, 8, 0, 0),
  endedAt: status === WorkbenchRunStatus.WaitingApproval ? null : Date.UTC(2026, 7, 20, 8, 2, 3),
  context: null,
  verificationResult: null,
  failure: null,
  createdAt: Date.UTC(2026, 7, 20, 8, 0, 0),
  updatedAt: Date.UTC(2026, 7, 20, 8, 2, 3),
});

const createEvent = (
  id: string,
  runId: string,
  type: WorkbenchRunEventType,
  sequence: number,
): WorkbenchRunEvent => ({
  id,
  runId,
  sequence,
  type,
  payload: {},
  createdAt: Date.UTC(2026, 7, 20, 8, 0, sequence),
});

const createPendingApproval = (id: string, runId: string): WorkbenchApproval => ({
  id,
  taskId: 'task-1',
  runId,
  toolCallId: `call-${id}`,
  toolName: 'write',
  riskLevel: WorkbenchApprovalRiskLevel.Reversible,
  decision: WorkbenchApprovalDecision.Pending,
  decisionSource: null,
  effectStatus: WorkbenchApprovalEffectStatus.NotStarted,
  idempotencyKey: `key-${id}`,
  request: { path: 'output/report.txt' },
  result: null,
  createdAt: Date.UTC(2026, 7, 20, 8, 1, 0),
  updatedAt: Date.UTC(2026, 7, 20, 8, 1, 0),
  decidedAt: null,
});

const createArtifact = (id: string, runId: string, reference: string): WorkbenchArtifact => ({
  id,
  taskId: 'task-1',
  runId,
  kind: WorkbenchArtifactKind.File,
  mimeType: 'text/plain',
  reference,
  contentHash: `hash-${id}`,
  provenance: WorkbenchArtifactProvenance.Workspace,
  verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
  metadata: {},
  createdAt: Date.UTC(2026, 7, 20, 8, 1, 30),
  updatedAt: Date.UTC(2026, 7, 20, 8, 1, 30),
});

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

test('renders the selected task summary instead of its id in the history trigger', () => {
  const currentTask = createTask(
    'task-current-id',
    'Generate a product analysis report',
    WorkbenchTaskStatus.Completed,
    Date.UTC(2026, 7, 19, 11, 18, 1),
  );
  const previousTask = createTask(
    'task-previous-id',
    'Organize historical data',
    WorkbenchTaskStatus.Cancelled,
    Date.UTC(2026, 7, 19, 10, 17, 35),
  );
  const detail: WorkbenchTaskDetail = {
    task: currentTask,
    runs: [],
    events: [],
    artifacts: [],
    approvals: [],
  };

  render(
    createElement(WorkbenchTaskAuditView, {
      detail,
      tasks: [currentTask, previousTask],
      busy: false,
      loading: false,
      onSelectTask: vi.fn(),
      onRespondToApproval: vi.fn(),
    }),
  );

  const historyTrigger = screen.getByRole('combobox');
  expect(within(historyTrigger).getByText(statusLabel(currentTask.status))).toBeTruthy();
  expect(within(historyTrigger).getByText(currentTask.goal)).toBeTruthy();
  expect(within(historyTrigger).getByText(formatTimestamp(currentTask.createdAt))).toBeTruthy();
  expect(historyTrigger).not.toHaveTextContent(currentTask.id);
});

test('renders runs, events, approvals, and artifacts as a single timeline', () => {
  const task = {
    ...createTask(
      'task-timeline-id',
      'Inspect the timeline layout',
      WorkbenchTaskStatus.Running,
      Date.UTC(2026, 7, 20, 8, 0, 0),
    ),
    activeRunId: 'run-2',
  };
  const firstRun = createRun('run-1', 1, WorkbenchRunStatus.Failed);
  const activeRun = createRun('run-2', 2, WorkbenchRunStatus.WaitingApproval);
  const detail: WorkbenchTaskDetail = {
    task,
    runs: [activeRun, firstRun],
    events: [
      createEvent('event-started', activeRun.id, WorkbenchRunEventType.RunStarted, 1),
      createEvent('event-read-1', activeRun.id, WorkbenchRunEventType.ToolRead, 2),
      createEvent('event-read-2', activeRun.id, WorkbenchRunEventType.ToolRead, 3),
      createEvent('event-read-3', activeRun.id, WorkbenchRunEventType.ToolRead, 4),
    ],
    artifacts: [createArtifact('artifact-1', activeRun.id, 'output/report.txt')],
    approvals: [createPendingApproval('approval-1', activeRun.id)],
  };

  render(
    createElement(WorkbenchTaskAuditView, {
      detail,
      tasks: [task],
      busy: false,
      loading: false,
      onSelectTask: vi.fn(),
      onRespondToApproval: vi.fn(),
    }),
  );

  // Both chapters render their attempt labels; the first stays collapsed.
  expect(
    screen.getByText(i18nService.t('workbenchTaskRunAttempt').replace('{attempt}', '1')),
  ).toBeTruthy();
  expect(
    screen.getByText(i18nService.t('workbenchTaskRunAttempt').replace('{attempt}', '2')),
  ).toBeTruthy();

  // The active run chapter is expanded: events, the read cluster, the pending
  // approval card, and the artifact row are all visible.
  expect(screen.getByText(i18nService.t('workbenchTaskEventRunStarted'))).toBeTruthy();
  expect(screen.getByText('×3')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: i18nService.t('workbenchTaskApprove') }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: i18nService.t('workbenchTaskDeny') })).toBeTruthy();
  expect(screen.getByText('output/report.txt')).toBeTruthy();
});
