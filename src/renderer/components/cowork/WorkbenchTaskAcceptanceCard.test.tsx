// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchTaskDetail,
} from '../../../shared/workbenchTask';
import { i18nService } from '../../services/i18n';
import { WorkbenchTaskAcceptanceCard } from './WorkbenchTaskAcceptanceCard';

const task: WorkbenchTask = {
  id: 'task-1',
  sessionId: 'session-1',
  goal: 'Build a deck',
  status: WorkbenchTaskStatus.NeedsReview,
  activeRunId: 'run-1',
  contract: {
    kind: 'generic_work',
    requiresUserAcceptance: true,
    metadata: {},
  },
  createdAt: 1,
  updatedAt: 1,
};

const run: WorkbenchRun = {
  id: 'run-1',
  taskId: task.id,
  attempt: 1,
  status: WorkbenchRunStatus.NeedsReview,
  trigger: 'message',
  startedAt: 1,
  endedAt: 2,
  context: null,
  verificationResult: {
    outcome: WorkbenchVerificationOutcome.AcceptanceRequired,
    checks: [],
    evidence: [],
    summary: 'The result requires explicit user acceptance.',
  },
  failure: null,
  createdAt: 1,
  updatedAt: 2,
};

const detail: WorkbenchTaskDetail = {
  task,
  runs: [run],
  events: [],
  artifacts: [],
  approvals: [],
};

const accept = vi.fn().mockResolvedValue({ success: true });
const retry = vi.fn().mockResolvedValue({ success: true, detail });

beforeEach(() => {
  (window as { electron?: unknown }).electron = {
    workbenchTask: {
      getCurrent: vi.fn().mockResolvedValue({ success: true, detail }),
      accept,
      retry,
      onChanged: vi.fn(() => () => undefined),
    },
  };
});

test('renders the acceptance card when the task awaits manual acceptance', async () => {
  render(<WorkbenchTaskAcceptanceCard sessionId="session-1" />);

  await waitFor(() => {
    expect(screen.getByText(i18nService.t('workbenchTaskAcceptanceCardTitle'))).toBeTruthy();
  });
  expect(screen.getByText(i18nService.t('workbenchTaskAccept'))).toBeTruthy();
  expect(screen.getByText(i18nService.t('workbenchTaskRetry'))).toBeTruthy();
  expect(
    screen.getByText('The result requires explicit user acceptance.'),
  ).toBeTruthy();
});

test('accept calls the workbench accept action', async () => {
  render(<WorkbenchTaskAcceptanceCard sessionId="session-1" />);

  await waitFor(() => {
    expect(screen.getByText(i18nService.t('workbenchTaskAccept'))).toBeTruthy();
  });
  screen.getByText(i18nService.t('workbenchTaskAccept')).click();
  await waitFor(() => expect(accept).toHaveBeenCalledWith('task-1'));
});

test('renders nothing when the task is completed', async () => {
  (window as { electron?: unknown }).electron = {
    workbenchTask: {
      getCurrent: vi.fn().mockResolvedValue({
        success: true,
        detail: {
          ...detail,
          task: { ...task, status: WorkbenchTaskStatus.Completed },
        },
      }),
      accept,
      retry,
      onChanged: vi.fn(() => () => undefined),
    },
  };

  render(<WorkbenchTaskAcceptanceCard sessionId="session-1" />);

  await waitFor(() => {
    expect(screen.queryByText(i18nService.t('workbenchTaskAcceptanceCardTitle'))).toBeNull();
  });
});
