import { Empty, EmptyHeader, EmptyTitle } from '@shared/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';

import type { WorkbenchArtifact, WorkbenchRun } from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import {
  artifactKindLabel,
  artifactProvenanceLabel,
  artifactVerificationLabel,
  getRunAttempt,
} from './utils';

interface ArtifactAuditTabProps {
  artifacts: WorkbenchArtifact[];
  runs: WorkbenchRun[];
}

export function ArtifactAuditTab({ artifacts, runs }: ArtifactAuditTabProps) {
  if (artifacts.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{i18nService.t('workbenchTaskNoArtifacts')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{i18nService.t('workbenchTaskAttempt')}</TableHead>
          <TableHead>{i18nService.t('workbenchTaskReference')}</TableHead>
          <TableHead>{i18nService.t('workbenchTaskType')}</TableHead>
          <TableHead>{i18nService.t('workbenchTaskSource')}</TableHead>
          <TableHead>{i18nService.t('workbenchTaskHash')}</TableHead>
          <TableHead>{i18nService.t('workbenchTaskVerification')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map(artifact => (
          <TableRow key={artifact.id}>
            <TableCell>{getRunAttempt(runs, artifact.runId) ?? '-'}</TableCell>
            <TableCell className="max-w-[240px] truncate">{artifact.reference}</TableCell>
            <TableCell>{artifactKindLabel(artifact.kind)}</TableCell>
            <TableCell>{artifactProvenanceLabel(artifact.provenance)}</TableCell>
            <TableCell className="max-w-48 truncate font-mono text-xs">
              {artifact.contentHash}
            </TableCell>
            <TableCell>{artifactVerificationLabel(artifact.verificationStatus)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
