// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import {
  WorkbenchRunEventType,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  type WorkbenchRun,
  type WorkbenchRunEvent,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { EventAuditTab } from './EventAuditTab';

const run: WorkbenchRun = {
  id: 'run-1',
  taskId: 'task-1',
  attempt: 2,
  status: WorkbenchRunStatus.Running,
  trigger: WorkbenchRunTrigger.Retry,
  startedAt: 1,
  endedAt: null,
  context: null,
  verificationResult: null,
  failure: null,
  createdAt: 1,
  updatedAt: 1,
};

const event: WorkbenchRunEvent = {
  id: 'event-1',
  runId: run.id,
  sequence: 1,
  type: WorkbenchRunEventType.RunStarted,
  payload: {},
  createdAt: 1,
};

test('renders an event with its owning run attempt', () => {
  render(<EventAuditTab events={[event]} runs={[run]} />);

  expect(screen.getByText(i18nService.t('workbenchTaskEventRunStarted'))).toBeTruthy();
  expect(
    screen.getByText(
      i18nService.t('workbenchTaskRunAttempt').replace('{attempt}', String(run.attempt)),
    ),
  ).toBeTruthy();
});

test('renders the empty state with an icon and the inactive tab text color', () => {
  const { container } = render(<EventAuditTab events={[]} runs={[]} />);

  const emptyState = container.querySelector<HTMLElement>('[data-slot="empty"]');
  expect(emptyState).toBeTruthy();
  expect(emptyState?.querySelector('svg')).toBeTruthy();
  expect(emptyState).toHaveClass('text-foreground/60', 'dark:text-muted-foreground');
  expect(screen.getByText(i18nService.t('workbenchTaskNoEvents'))).toBeTruthy();
});
