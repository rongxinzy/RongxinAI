// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  WorkbenchContractKind,
  WorkbenchTaskStatus,
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

test('stacks audit sections in independent desktop columns', () => {
  const task = createTask(
    'task-layout-id',
    'Inspect the audit layout',
    WorkbenchTaskStatus.Completed,
    Date.UTC(2026, 7, 20, 8, 30, 0),
  );
  const detail: WorkbenchTaskDetail = {
    task,
    runs: [],
    events: [],
    artifacts: [],
    approvals: [],
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

  const runsSection = screen.getByRole('region', {
    name: `${i18nService.t('workbenchTaskRuns')} (0)`,
  });
  const eventsSection = screen.getByRole('region', {
    name: `${i18nService.t('workbenchTaskEvents')} (0)`,
  });
  const artifactsSection = screen.getByRole('region', {
    name: `${i18nService.t('workbenchTaskArtifacts')} (0)`,
  });
  const approvalsSection = screen.getByRole('region', {
    name: `${i18nService.t('workbenchTaskApprovals')} (0)`,
  });

  expect(runsSection.parentElement).toBe(artifactsSection.parentElement);
  expect(eventsSection.parentElement).toBe(approvalsSection.parentElement);
  expect(runsSection.parentElement).not.toBe(eventsSection.parentElement);
  expect(runsSection.parentElement).toHaveClass('flex', 'flex-col', 'gap-4');
  expect(eventsSection.parentElement).toHaveClass('flex', 'flex-col', 'gap-4');
  expect(runsSection.parentElement?.parentElement).toHaveClass('grid', 'md:grid-cols-2');
});
