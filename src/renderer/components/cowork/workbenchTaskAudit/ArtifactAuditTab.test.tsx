// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';

import {
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  type WorkbenchArtifact,
} from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { ArtifactAuditTab } from './ArtifactAuditTab';

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

test('contains long artifact values without overlapping fixed action columns', () => {
  const reference = 'furmark_analysis/reports/very-long-performance-analysis-result.json';
  const contentHash = 'a249783279ab3e496449534bc5f47a274a3ffe67da7ed46b85f1e052fc2b755d';
  const artifact: WorkbenchArtifact = {
    id: 'artifact-1',
    taskId: 'task-1',
    runId: 'run-1',
    kind: WorkbenchArtifactKind.File,
    mimeType: 'application/json',
    reference,
    contentHash,
    provenance: WorkbenchArtifactProvenance.Workspace,
    verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  };

  render(<ArtifactAuditTab artifacts={[artifact]} runs={[]} />);

  const table = screen.getByRole('table');
  const referenceValue = screen.getByText(reference);
  const hashValue = screen.getByText(contentHash);
  const copyButton = screen.getByRole('button', {
    name: i18nService.t('workbenchTaskCopyHash'),
  });
  const actionCell = copyButton.closest('[data-slot="table-cell"]');

  expect(table).toHaveClass('min-w-max');
  expect(referenceValue).toHaveClass('block', 'w-56', 'truncate');
  expect(hashValue).toHaveClass('block', 'w-56', 'truncate');
  expect(actionCell).toHaveClass('w-28');
  expect(copyButton.parentElement).toHaveClass('shrink-0');
  expect(table.parentElement).toHaveClass('overflow-x-auto');
});
