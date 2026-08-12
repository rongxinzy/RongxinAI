import { Button } from '@shared/components/ui/button';
import { Empty, EmptyHeader, EmptyTitle } from '@shared/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { Copy, ExternalLink, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

import type { WorkbenchArtifact, WorkbenchRun } from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import {
  artifactKindLabel,
  artifactProvenanceLabel,
  artifactVerificationLabel,
  getRunAttempt,
  resolveArtifactFilePath,
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

  const showActionError = (error?: string) =>
    toast.error(
      i18nService
        .t('workbenchTaskArtifactActionFailed')
        .replace('{error}', error || i18nService.t('unknownError')),
    );

  const openArtifact = async (filePath: string) => {
    try {
      const result = await window.electron.shell.openPath(filePath);
      if (!result.success) showActionError(result.error);
    } catch (error) {
      showActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const revealArtifact = async (filePath: string) => {
    try {
      const result = await window.electron.shell.showItemInFolder(filePath);
      if (!result.success) showActionError(result.error);
    } catch (error) {
      showActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const copyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      toast.success(i18nService.t('workbenchTaskHashCopied'));
    } catch (error) {
      showActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{i18nService.t('workbenchTaskAttempt')}</TableHead>
            <TableHead>{i18nService.t('workbenchTaskReference')}</TableHead>
            <TableHead>{i18nService.t('workbenchTaskType')}</TableHead>
            <TableHead>{i18nService.t('workbenchTaskSource')}</TableHead>
            <TableHead>{i18nService.t('workbenchTaskHash')}</TableHead>
            <TableHead>{i18nService.t('workbenchTaskVerification')}</TableHead>
            <TableHead className="text-right">{i18nService.t('workbenchTaskActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {artifacts.map(artifact => {
            const filePath = resolveArtifactFilePath(artifact, runs);
            return (
              <TableRow key={artifact.id}>
                <TableCell>{getRunAttempt(runs, artifact.runId) ?? '-'}</TableCell>
                <TableCell className="max-w-[240px] truncate">{artifact.reference}</TableCell>
                <TableCell>{artifactKindLabel(artifact.kind)}</TableCell>
                <TableCell>{artifactProvenanceLabel(artifact.provenance)}</TableCell>
                <TableCell className="max-w-48 truncate font-mono text-xs">
                  {artifact.contentHash}
                </TableCell>
                <TableCell>{artifactVerificationLabel(artifact.verificationStatus)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {filePath && (
                      <>
                        <ArtifactAction
                          label={i18nService.t('workbenchTaskOpenArtifact')}
                          icon={ExternalLink}
                          onClick={() => void openArtifact(filePath)}
                        />
                        <ArtifactAction
                          label={i18nService.t('workbenchTaskRevealArtifact')}
                          icon={FolderOpen}
                          onClick={() => void revealArtifact(filePath)}
                        />
                      </>
                    )}
                    <ArtifactAction
                      label={i18nService.t('workbenchTaskCopyHash')}
                      icon={Copy}
                      onClick={() => void copyHash(artifact.contentHash)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

function ArtifactAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
