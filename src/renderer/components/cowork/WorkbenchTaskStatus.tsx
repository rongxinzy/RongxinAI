import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
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
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchApprovalResponseInput,
  type WorkbenchTaskActionResult,
  type WorkbenchTaskDetail,
} from '../../../shared/workbenchTask';
import { i18nService } from '../../services/i18n';
import type { AppDispatch } from '../../store';
import { setActiveArtifactProjection } from '../../store/slices/artifactSlice';
import { WorkbenchTaskAuditSheet } from './workbenchTaskAudit/WorkbenchTaskAuditSheet';
import { getProjectedRun, statusBadgeVariant, statusLabel } from './workbenchTaskAudit/utils';

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

  const applyDetail = useCallback(
    (nextDetail: WorkbenchTaskDetail | null) => {
      setDetail(nextDetail);
      const projectedRun = getProjectedRun(nextDetail);
      dispatch(
        setActiveArtifactProjection({
          sessionId,
          taskId: nextDetail?.task.id ?? null,
          runId: projectedRun?.id ?? null,
        }),
      );
    },
    [dispatch, sessionId],
  );

  const load = useCallback(async () => {
    try {
      const result = await window.electron.workbenchTask.getCurrent(sessionId);
      if (!result.success) throw new Error(result.error);
      applyDetail(result.detail ?? null);
    } catch (error) {
      console.error('[WorkbenchTask] Failed to load task audit detail:', error);
      toast.error(i18nService.t('workbenchTaskLoadFailed'));
    }
  }, [applyDetail, sessionId]);

  useEffect(() => {
    applyDetail(null);
    void load();
    return window.electron.workbenchTask.onChanged(event => {
      if (event.sessionId === sessionId) void load();
    });
  }, [applyDetail, load, sessionId]);

  const activeRun = useMemo(() => getProjectedRun(detail), [detail]);
  const canAccept =
    detail?.task.status === WorkbenchTaskStatus.NeedsReview &&
    activeRun?.verificationResult?.outcome === WorkbenchVerificationOutcome.AcceptanceRequired;
  const canResume = detail?.task.status === WorkbenchTaskStatus.Paused;
  const canRetry =
    detail?.task.status === WorkbenchTaskStatus.NeedsReview ||
    detail?.task.status === WorkbenchTaskStatus.Failed ||
    detail?.task.status === WorkbenchTaskStatus.Completed;

  const runAction = useCallback(
    async (action: () => Promise<WorkbenchTaskActionResult>) => {
      setBusy(true);
      try {
        const result = await action();
        if (!result.success) throw new Error(result.error);
        if (result.detail) applyDetail(result.detail);
      } catch (error) {
        console.error('[WorkbenchTask] Task action failed:', error);
        toast.error(i18nService.t('workbenchTaskActionFailed'));
      } finally {
        setBusy(false);
      }
    },
    [applyDetail],
  );

  const respondToApproval = useCallback(
    (input: WorkbenchApprovalResponseInput) => {
      void runAction(() => window.electron.workbenchTask.respondToApproval(input));
    },
    [runAction],
  );

  if (!detail) return null;

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
                  <Badge variant={statusBadgeVariant(detail.task.status)}>
                    {statusLabel(detail.task.status)}
                  </Badge>
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

      <WorkbenchTaskAuditSheet
        detail={detail}
        open={open}
        busy={busy}
        onOpenChange={setOpen}
        onRespondToApproval={respondToApproval}
      />
    </>
  );
}
