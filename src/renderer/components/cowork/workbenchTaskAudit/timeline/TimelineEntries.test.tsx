// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  type WorkbenchApproval,
  type WorkbenchArtifact,
  type WorkbenchRun,
} from '../../../../../shared/workbenchTask';
import { i18nService } from '../../../../services/i18n';
import { TimelineEntryList } from './TimelineEntries';
import type { TimelineEntry } from './timelineModel';

const waitingRun: WorkbenchRun = {
  id: 'run-1',
  taskId: 'task-1',
  attempt: 1,
  status: WorkbenchRunStatus.WaitingApproval,
  trigger: WorkbenchRunTrigger.Message,
  startedAt: 1000,
  endedAt: null,
  context: null,
  verificationResult: null,
  failure: null,
  createdAt: 1000,
  updatedAt: 1000,
};

const createArtifact = (reference: string): WorkbenchArtifact => ({
  id: 'artifact-1',
  taskId: 'task-1',
  runId: waitingRun.id,
  kind: WorkbenchArtifactKind.File,
  mimeType: 'application/json',
  reference,
  contentHash: 'a249783279ab3e496449534bc5f47a274a3ffe67da7ed46b85f1e052fc2b755d',
  provenance: WorkbenchArtifactProvenance.Workspace,
  verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
  metadata: {},
  createdAt: 1000,
  updatedAt: 1000,
});

const createPendingApproval = (): WorkbenchApproval => ({
  id: 'approval-1',
  taskId: 'task-1',
  runId: waitingRun.id,
  toolCallId: 'call-1',
  toolName: 'write',
  riskLevel: WorkbenchApprovalRiskLevel.Reversible,
  decision: WorkbenchApprovalDecision.Pending,
  decisionSource: null,
  effectStatus: WorkbenchApprovalEffectStatus.NotStarted,
  idempotencyKey: 'key-1',
  request: { path: 'output/report.txt' },
  result: null,
  createdAt: 1000,
  updatedAt: 1000,
  decidedAt: null,
});

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

test('truncates long artifact references and keeps the copy-hash action', () => {
  const reference = 'furmark_analysis/reports/very-long-performance-analysis-result.json';
  const entries: TimelineEntry[] = [
    { kind: 'artifact', id: 'artifact-1', artifact: createArtifact(reference), createdAt: 1000 },
  ];

  render(
    <TimelineEntryList
      entries={entries}
      run={waitingRun}
      runs={[waitingRun]}
      busy={false}
      onRespondToApproval={vi.fn()}
    />,
  );

  expect(screen.getByText(reference)).toHaveClass('truncate');
  expect(
    screen.getByRole('button', { name: i18nService.t('workbenchTaskCopyHash') }),
  ).toBeTruthy();
});

test('approving a pending approval responds with the approval id', () => {
  const onRespondToApproval = vi.fn();
  const entries: TimelineEntry[] = [
    { kind: 'approval', id: 'approval-1', approval: createPendingApproval(), createdAt: 1000 },
  ];

  render(
    <TimelineEntryList
      entries={entries}
      run={waitingRun}
      runs={[waitingRun]}
      busy={false}
      onRespondToApproval={onRespondToApproval}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: i18nService.t('workbenchTaskApprove') }));

  expect(onRespondToApproval).toHaveBeenCalledWith({ approvalId: 'approval-1', approved: true });
});

test('denying a pending approval forwards the trimmed denial reason', () => {
  const onRespondToApproval = vi.fn();
  const entries: TimelineEntry[] = [
    { kind: 'approval', id: 'approval-1', approval: createPendingApproval(), createdAt: 1000 },
  ];

  render(
    <TimelineEntryList
      entries={entries}
      run={waitingRun}
      runs={[waitingRun]}
      busy={false}
      onRespondToApproval={onRespondToApproval}
    />,
  );

  fireEvent.change(screen.getByLabelText(i18nService.t('workbenchTaskDenialReason')), {
    target: { value: '  路径不对  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('workbenchTaskDeny') }));

  expect(onRespondToApproval).toHaveBeenCalledWith({
    approvalId: 'approval-1',
    approved: false,
    reason: '路径不对',
  });
});

test('a pending approval on a non-waiting run renders as history, not an action card', () => {
  const resolvedRun: WorkbenchRun = { ...waitingRun, status: WorkbenchRunStatus.Succeeded };
  const entries: TimelineEntry[] = [
    { kind: 'approval', id: 'approval-1', approval: createPendingApproval(), createdAt: 1000 },
  ];

  render(
    <TimelineEntryList
      entries={entries}
      run={resolvedRun}
      runs={[resolvedRun]}
      busy={false}
      onRespondToApproval={vi.fn()}
    />,
  );

  expect(screen.queryByRole('button', { name: i18nService.t('workbenchTaskApprove') })).toBeNull();
  expect(screen.getByText(i18nService.t('workbenchTaskDecisionPending'))).toBeTruthy();
});
