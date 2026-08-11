import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@shared/components/ai-elements/confirmation';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Empty, EmptyHeader, EmptyTitle } from '@shared/components/ui/empty';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shared/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { Check, ClipboardCheck, Play, RefreshCw, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'sonner';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchTaskActionResult,
  type WorkbenchTaskDetail,
} from '../../../shared/workbenchTask';
import { i18nService } from '../../services/i18n';
import type { AppDispatch } from '../../store';
import { setActiveArtifactProjection } from '../../store/slices/artifactSlice';

const WorkbenchTaskTab = {
  Runs: 'runs',
  Artifacts: 'artifacts',
  Approvals: 'approvals',
} as const;

const statusTranslationKeys: Record<string, string> = {
  [WorkbenchTaskStatus.Draft]: 'workbenchTaskStatusDraft',
  [WorkbenchTaskStatus.Planned]: 'workbenchTaskStatusPlanned',
  [WorkbenchTaskStatus.Running]: 'workbenchTaskStatusRunning',
  [WorkbenchTaskStatus.Paused]: 'workbenchTaskStatusPaused',
  [WorkbenchTaskStatus.NeedsReview]: 'workbenchTaskStatusNeedsReview',
  [WorkbenchTaskStatus.Completed]: 'workbenchTaskStatusCompleted',
  [WorkbenchTaskStatus.Failed]: 'workbenchTaskStatusFailed',
  [WorkbenchTaskStatus.Cancelled]: 'workbenchTaskStatusCancelled',
  [WorkbenchRunStatus.Queued]: 'workbenchTaskStatusQueued',
  [WorkbenchRunStatus.WaitingApproval]: 'workbenchTaskStatusWaitingApproval',
  [WorkbenchRunStatus.Verifying]: 'workbenchTaskStatusVerifying',
  [WorkbenchRunStatus.Succeeded]: 'workbenchTaskStatusSucceeded',
};

const triggerTranslationKeys: Record<string, string> = {
  [WorkbenchRunTrigger.Message]: 'workbenchTaskTriggerMessage',
  [WorkbenchRunTrigger.Retry]: 'workbenchTaskTriggerRetry',
  [WorkbenchRunTrigger.Resume]: 'workbenchTaskTriggerResume',
};

const decisionTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalDecision.Pending]: 'workbenchTaskDecisionPending',
  [WorkbenchApprovalDecision.Approved]: 'workbenchTaskDecisionApproved',
  [WorkbenchApprovalDecision.Denied]: 'workbenchTaskDecisionDenied',
  [WorkbenchApprovalDecision.Expired]: 'workbenchTaskDecisionExpired',
};

const decisionSourceTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalDecisionSource.User]: 'workbenchTaskDecisionSourceUser',
  [WorkbenchApprovalDecisionSource.Policy]: 'workbenchTaskDecisionSourcePolicy',
  [WorkbenchApprovalDecisionSource.Recovery]: 'workbenchTaskDecisionSourceRecovery',
};

const riskTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalRiskLevel.ReadOnly]: 'workbenchTaskRiskReadOnly',
  [WorkbenchApprovalRiskLevel.Reversible]: 'workbenchTaskRiskReversible',
  [WorkbenchApprovalRiskLevel.Irreversible]: 'workbenchTaskRiskIrreversible',
  [WorkbenchApprovalRiskLevel.Unknown]: 'workbenchTaskRiskUnknown',
};

const effectTranslationKeys: Record<string, string> = {
  [WorkbenchApprovalEffectStatus.NotStarted]: 'workbenchTaskEffectNotStarted',
  [WorkbenchApprovalEffectStatus.Executing]: 'workbenchTaskEffectExecuting',
  [WorkbenchApprovalEffectStatus.Succeeded]: 'workbenchTaskEffectSucceeded',
  [WorkbenchApprovalEffectStatus.Failed]: 'workbenchTaskEffectFailed',
  [WorkbenchApprovalEffectStatus.NeedsReview]: 'workbenchTaskEffectNeedsReview',
};

const artifactKindTranslationKeys: Record<string, string> = {
  [WorkbenchArtifactKind.File]: 'workbenchTaskArtifactFile',
  [WorkbenchArtifactKind.MessageBlock]: 'workbenchTaskArtifactMessageBlock',
  [WorkbenchArtifactKind.Evidence]: 'workbenchTaskArtifactEvidence',
};

const artifactVerificationTranslationKeys: Record<string, string> = {
  [WorkbenchArtifactVerificationStatus.Pending]: 'workbenchTaskArtifactPending',
  [WorkbenchArtifactVerificationStatus.Verified]: 'workbenchTaskArtifactVerified',
  [WorkbenchArtifactVerificationStatus.Failed]: 'workbenchTaskArtifactFailed',
};

const artifactProvenanceTranslationKeys: Record<string, string> = {
  [WorkbenchArtifactProvenance.Workspace]: 'workbenchTaskProvenanceWorkspace',
  [WorkbenchArtifactProvenance.Message]: 'workbenchTaskProvenanceMessage',
  [WorkbenchArtifactProvenance.Controller]: 'workbenchTaskProvenanceController',
};

const translated = (keys: Record<string, string>, value: string): string =>
  i18nService.t(keys[value] || value);

const statusBadgeVariant = (status: string): 'secondary' | 'outline' | 'destructive' => {
  if (status === WorkbenchTaskStatus.Failed || status === WorkbenchRunStatus.Failed) {
    return 'destructive';
  }
  if (
    status === WorkbenchTaskStatus.NeedsReview ||
    status === WorkbenchTaskStatus.Paused ||
    status === WorkbenchRunStatus.NeedsReview ||
    status === WorkbenchRunStatus.Paused
  ) {
    return 'outline';
  }
  return 'secondary';
};

const formatTimestamp = (value: number | null): string =>
  value ? new Date(value).toLocaleString() : '-';

const formatResult = (value: Record<string, unknown> | null): string =>
  value ? JSON.stringify(value) : '-';

interface WorkbenchTaskStatusProps {
  sessionId: string;
}

interface WorkbenchTaskActionButtonProps {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

function WorkbenchTaskActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: WorkbenchTaskActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            <Icon />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function WorkbenchTaskStatusBar({ sessionId }: WorkbenchTaskStatusProps) {
  const dispatch = useDispatch<AppDispatch>();
  const [detail, setDetail] = useState<WorkbenchTaskDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await window.electron.workbenchTask.getCurrent(sessionId);
    if (!result.success) return;
    const nextDetail = result.detail ?? null;
    setDetail(nextDetail);
    const projectedRun =
      nextDetail?.runs.find(run => run.id === nextDetail.task.activeRunId) ??
      nextDetail?.runs[0] ??
      null;
    dispatch(
      setActiveArtifactProjection({
        sessionId,
        taskId: nextDetail?.task.id ?? null,
        runId: projectedRun?.id ?? null,
      }),
    );
  }, [dispatch, sessionId]);

  useEffect(() => {
    setDetail(null);
    void load();
    return window.electron.workbenchTask.onChanged(event => {
      if (event.sessionId === sessionId) void load();
    });
  }, [load, sessionId]);

  const activeRun = useMemo(
    () => detail?.runs.find(run => run.id === detail.task.activeRunId) ?? detail?.runs[0] ?? null,
    [detail],
  );
  const canAccept =
    detail?.task.status === WorkbenchTaskStatus.NeedsReview &&
    activeRun?.verificationResult?.outcome === WorkbenchVerificationOutcome.AcceptanceRequired;
  const canResume = detail?.task.status === WorkbenchTaskStatus.Paused;
  const canRetry =
    detail?.task.status === WorkbenchTaskStatus.NeedsReview ||
    detail?.task.status === WorkbenchTaskStatus.Failed ||
    detail?.task.status === WorkbenchTaskStatus.Completed;

  const runAction = useCallback(async (action: () => Promise<WorkbenchTaskActionResult>) => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error);
      if (result.detail) setDetail(result.detail);
    } catch {
      toast.error(i18nService.t('workbenchTaskActionFailed'));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!detail) return null;

  const taskStatusLabel = translated(statusTranslationKeys, detail.task.status);

  return (
    <>
      <TooltipProvider>
        <div className="non-draggable flex min-w-0 shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={i18nService.t('workbenchTaskDetails')}
                  onClick={() => setOpen(true)}
                >
                  <ClipboardCheck data-icon="inline-start" />
                  <Badge variant={statusBadgeVariant(detail.task.status)}>{taskStatusLabel}</Badge>
                </Button>
              }
            />
            <TooltipContent>{i18nService.t('workbenchTaskDetails')}</TooltipContent>
          </Tooltip>
          {canResume && (
            <WorkbenchTaskActionButton
              icon={Play}
              label={i18nService.t('workbenchTaskResume')}
              disabled={busy}
              onClick={() =>
                void runAction(() =>
                  window.electron.workbenchTask.resume({ taskId: detail.task.id }),
                )
              }
            />
          )}
          {canAccept && (
            <WorkbenchTaskActionButton
              icon={Check}
              label={i18nService.t('workbenchTaskAccept')}
              disabled={busy}
              onClick={() =>
                void runAction(() => window.electron.workbenchTask.accept(detail.task.id))
              }
            />
          )}
          {canRetry && !canAccept && (
            <WorkbenchTaskActionButton
              icon={RefreshCw}
              label={i18nService.t('workbenchTaskRetry')}
              disabled={busy}
              onClick={() =>
                void runAction(() => window.electron.workbenchTask.retry(detail.task.id))
              }
            />
          )}
        </div>
      </TooltipProvider>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{i18nService.t('workbenchTaskDetails')}</SheetTitle>
            <SheetDescription>{i18nService.t('workbenchTaskDetailsDescription')}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
            <div className="flex items-center gap-2">
              <Badge variant={statusBadgeVariant(detail.task.status)}>{taskStatusLabel}</Badge>
              <span className="min-w-0 truncate text-sm font-medium">{detail.task.goal}</span>
            </div>
            <Tabs defaultValue={WorkbenchTaskTab.Runs} className="min-h-0 flex-1">
              <TabsList variant="line">
                <TabsTrigger value={WorkbenchTaskTab.Runs}>
                  {i18nService.t('workbenchTaskRuns')}
                </TabsTrigger>
                <TabsTrigger value={WorkbenchTaskTab.Artifacts}>
                  {i18nService.t('workbenchTaskArtifacts')}
                </TabsTrigger>
                <TabsTrigger value={WorkbenchTaskTab.Approvals}>
                  {i18nService.t('workbenchTaskApprovals')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value={WorkbenchTaskTab.Runs} className="min-h-0">
                <ScrollArea className="h-full">
                  {detail.runs.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>{i18nService.t('workbenchTaskNoRuns')}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{i18nService.t('workbenchTaskAttempt')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskStatus')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskTrigger')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskStarted')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskEnded')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskVerificationSummary')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.runs.map(run => (
                          <TableRow key={run.id}>
                            <TableCell>{run.attempt}</TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(run.status)}>
                                {translated(statusTranslationKeys, run.status)}
                              </Badge>
                            </TableCell>
                            <TableCell>{translated(triggerTranslationKeys, run.trigger)}</TableCell>
                            <TableCell>{formatTimestamp(run.startedAt)}</TableCell>
                            <TableCell>{formatTimestamp(run.endedAt)}</TableCell>
                            <TableCell className="max-w-48 truncate">
                              {run.verificationResult?.summary ?? '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value={WorkbenchTaskTab.Artifacts} className="min-h-0">
                <ScrollArea className="h-full">
                  {detail.artifacts.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>{i18nService.t('workbenchTaskNoArtifacts')}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{i18nService.t('workbenchTaskReference')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskType')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskSource')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskHash')}</TableHead>
                          <TableHead>{i18nService.t('workbenchTaskVerification')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.artifacts.map(artifact => (
                          <TableRow key={artifact.id}>
                            <TableCell className="max-w-[240px] truncate">
                              {artifact.reference}
                            </TableCell>
                            <TableCell>
                              {translated(artifactKindTranslationKeys, artifact.kind)}
                            </TableCell>
                            <TableCell>
                              {translated(artifactProvenanceTranslationKeys, artifact.provenance)}
                            </TableCell>
                            <TableCell className="max-w-48 truncate font-mono text-xs">
                              {artifact.contentHash}
                            </TableCell>
                            <TableCell>
                              {translated(
                                artifactVerificationTranslationKeys,
                                artifact.verificationStatus,
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value={WorkbenchTaskTab.Approvals} className="min-h-0">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-3">
                    {detail.approvals
                      .filter(
                        approval =>
                          approval.decision === WorkbenchApprovalDecision.Pending &&
                          detail.runs.some(
                            run =>
                              run.id === approval.runId &&
                              run.status === WorkbenchRunStatus.WaitingApproval,
                          ),
                      )
                      .map(approval => (
                        <Confirmation
                          key={approval.id}
                          approval={{ id: approval.id }}
                          state="approval-requested"
                        >
                          <ConfirmationRequest>
                            <ConfirmationTitle>
                              {i18nService.t('workbenchTaskApprovalRequest')}: {approval.toolName}
                            </ConfirmationTitle>
                            <ConfirmationActions>
                              <ConfirmationAction
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void runAction(() =>
                                    window.electron.workbenchTask.respondToApproval({
                                      approvalId: approval.id,
                                      approved: false,
                                    }),
                                  )
                                }
                              >
                                {i18nService.t('workbenchTaskDeny')}
                              </ConfirmationAction>
                              <ConfirmationAction
                                disabled={busy}
                                onClick={() =>
                                  void runAction(() =>
                                    window.electron.workbenchTask.respondToApproval({
                                      approvalId: approval.id,
                                      approved: true,
                                    }),
                                  )
                                }
                              >
                                {i18nService.t('workbenchTaskApprove')}
                              </ConfirmationAction>
                            </ConfirmationActions>
                          </ConfirmationRequest>
                        </Confirmation>
                      ))}
                    {detail.approvals.length === 0 ? (
                      <Empty>
                        <EmptyHeader>
                          <EmptyTitle>{i18nService.t('workbenchTaskNoApprovals')}</EmptyTitle>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{i18nService.t('workbenchTaskTool')}</TableHead>
                            <TableHead>{i18nService.t('workbenchTaskRisk')}</TableHead>
                            <TableHead>{i18nService.t('workbenchTaskDecision')}</TableHead>
                            <TableHead>{i18nService.t('workbenchTaskDecisionSource')}</TableHead>
                            <TableHead>{i18nService.t('workbenchTaskEffect')}</TableHead>
                            <TableHead>{i18nService.t('workbenchTaskResult')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.approvals.map(approval => (
                            <TableRow key={approval.id}>
                              <TableCell>{approval.toolName}</TableCell>
                              <TableCell>
                                {translated(riskTranslationKeys, approval.riskLevel)}
                              </TableCell>
                              <TableCell>
                                {translated(decisionTranslationKeys, approval.decision)}
                              </TableCell>
                              <TableCell>
                                {approval.decisionSource
                                  ? translated(
                                      decisionSourceTranslationKeys,
                                      approval.decisionSource,
                                    )
                                  : '-'}
                              </TableCell>
                              <TableCell>
                                {translated(effectTranslationKeys, approval.effectStatus)}
                              </TableCell>
                              <TableCell className="max-w-48 truncate font-mono text-xs">
                                {formatResult(approval.result)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
