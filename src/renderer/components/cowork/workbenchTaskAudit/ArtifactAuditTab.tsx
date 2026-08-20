import { Button } from '@shared/components/ui/button';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/components/ui/empty';
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
import { Copy, ExternalLink, FolderOpen, PackageOpen } from 'lucide-react';
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
      <Empty className="py-8 text-foreground/60 dark:text-muted-foreground">
        <EmptyHeader>
          <EmptyMedia className="mb-0">
            <PackageOpen className="size-5" />
          </EmptyMedia>
          <EmptyTitle className="font-normal">
            {i18nService.t('workbenchTaskNoArtifacts')}
          </EmptyTitle>
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
      <Table className="min-w-max">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">{i18nService.t('workbenchTaskAttempt')}</TableHead>
            <TableHead className="w-56">{i18nService.t('workbenchTaskReference')}</TableHead>
            <TableHead className="w-20">{i18nService.t('workbenchTaskType')}</TableHead>
            <TableHead className="w-24">{i18nService.t('workbenchTaskSource')}</TableHead>
            <TableHead className="w-56">{i18nService.t('workbenchTaskHash')}</TableHead>
            <TableHead className="w-24">{i18nService.t('workbenchTaskVerification')}</TableHead>
            <TableHead className="w-28 text-right">
              {i18nService.t('workbenchTaskActions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {artifacts.map(artifact => {
            const filePath = resolveArtifactFilePath(artifact, runs);
            return (
              <TableRow key={artifact.id}>
                <TableCell className="w-12">{getRunAttempt(runs, artifact.runId) ?? '-'}</TableCell>
                <TableCell className="w-56">
                  <span className="block w-56 truncate">{artifact.reference}</span>
                </TableCell>
                <TableCell className="w-20">{artifactKindLabel(artifact.kind)}</TableCell>
                <TableCell className="w-24">
                  {artifactProvenanceLabel(artifact.provenance)}
                </TableCell>
                <TableCell className="w-56">
                  <code className="block w-56 truncate font-mono text-xs">
                    {artifact.contentHash}
                  </code>
                </TableCell>
                <TableCell className="w-24">
                  {artifactVerificationLabel(artifact.verificationStatus)}
                </TableCell>
                <TableCell className="w-28">
                  <div className="flex shrink-0 justify-end gap-1">
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
