// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';
import {
  WorkbenchContractKind,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchTaskDetail,
} from '../../../shared/workbenchTask';
import { i18nService } from '../../services/i18n';
import { WorkbenchTaskAcceptanceCard } from './WorkbenchTaskAcceptanceCard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const detail: WorkbenchTaskDetail = {
  task: {
    id: 'task',
    sessionId: 'session',
    goal: 'Create a report',
    status: WorkbenchTaskStatus.NeedsReview,
    activeRunId: 'run',
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: true },
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
  },
  runs: [
    {
      id: 'run',
      taskId: 'task',
      attempt: 1,
      status: WorkbenchRunStatus.NeedsReview,
      trigger: WorkbenchRunTrigger.Message,
      startedAt: 1,
      endedAt: 2,
      context: null,
      failure: null,
      createdAt: 1,
      updatedAt: 2,
      verificationResult: {
        outcome: WorkbenchVerificationOutcome.AcceptanceRequired,
        checks: [],
        evidence: [],
        summary: 'Final report',
      },
    },
  ],
  artifacts: [],
  approvals: [],
  events: [],
};

test.each([true, false])(
  'acceptance shows success only on a successful IPC response (%s)',
  async success => {
    const accept = vi
      .fn()
      .mockResolvedValue({ success, error: success ? undefined : 'Verification failed' });
    const stopSession = vi.fn();
    (window as { electron?: unknown }).electron = {
      cowork: { stopSession },
      workbenchTask: {
        getCurrent: async () => ({ success: true, detail }),
        onChanged: () => () => undefined,
        accept,
      },
    };
    render(React.createElement(WorkbenchTaskAcceptanceCard, { sessionId: 'session' }));
    const button = await screen.findByRole('button', {
      name: i18nService.t('workbenchTaskAccept'),
    });
    fireEvent.click(button);
    await waitFor(() => expect(accept).toHaveBeenCalledWith('task'));
    if (success)
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(i18nService.t('workbenchTaskAcceptedToast')),
      );
    else {
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(toast.success).not.toHaveBeenCalled();
    }
    expect(stopSession).not.toHaveBeenCalled();
  },
);

test('failed deterministic delivery does not render an acceptance button', async () => {
  (window as { electron?: unknown }).electron = {
    workbenchTask: {
      getCurrent: async () => ({
        success: true,
        detail: {
          ...detail,
          runs: [
            {
              ...detail.runs[0],
              verificationResult: {
                ...detail.runs[0].verificationResult!,
                outcome: WorkbenchVerificationOutcome.Failed,
              },
            },
          ],
        },
      }),
      onChanged: () => () => undefined,
    },
  };
  await act(async () => {
    render(React.createElement(WorkbenchTaskAcceptanceCard, { sessionId: 'session' }));
  });
  expect(screen.queryByRole('button', { name: i18nService.t('workbenchTaskAccept') })).toBeNull();
});
