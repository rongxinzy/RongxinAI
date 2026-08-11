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
  type WorkbenchTask,
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
  const [auditDetail, setAuditDetail] = useState<WorkbenchTaskDetail | null>(null);
  const [taskHistory, setTaskHistory] = useState<WorkbenchTask[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const applyDetail = useCallback(
    (nextDetail: WorkbenchTaskDetail | null) => {
      setDetail(nextDetail);
      setAuditDetail(current => {
        if (!nextDetail) return null;
        return !current || current.task.id === nextDetail.task.id ? nextDetail : current;
      });
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

  const loadTaskHistory = useCallback(async () => {
    setAuditLoading(true);
    try {
      const result = await window.electron.workbenchTask.listForSession(sessionId);
      if (!result.success) throw new Error(result.error);
      setTaskHistory(result.tasks ?? []);
    } catch (error) {
      console.error('[WorkbenchTask] Failed to load task audit history:', error);
      toast.error(i18nService.t('workbenchTaskHistoryLoadFailed'));
    } finally {
      setAuditLoading(false);
    }
  }, [sessionId]);

  const selectAuditTask = useCallback(async (taskId: string) => {
    setAuditLoading(true);
    try {
      const result = await window.electron.workbenchTask.getDetail(taskId);
      if (!result.success || !result.detail) throw new Error(result.error);
      setAuditDetail(result.detail);
    } catch (error) {
      console.error('[WorkbenchTask] Failed to load historical task detail:', error);
      toast.error(i18nService.t('workbenchTaskLoadFailed'));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) return;
      setAuditDetail(detail);
      void loadTaskHistory();
    },
    [detail, loadTaskHistory],
  );

  useEffect(() => {
    applyDetail(null);
    setTaskHistory([]);
    void load();
    return window.electron.workbenchTask.onChanged(event => {
      if (event.sessionId !== sessionId) return;
      void load();
      void loadTaskHistory();
    });
  }, [applyDetail, load, loadTaskHistory, sessionId]);

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
    async (action: () => Promise<WorkbenchTaskActionResult>, updateCurrent = true) => {
      setBusy(true);
      try {
        const result = await action();
        if (!result.success) throw new Error(result.error);
        if (result.detail) {
          if (updateCurrent) applyDetail(result.detail);
          else setAuditDetail(result.detail);
        }
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
      void runAction(() => window.electron.workbenchTask.respondToApproval(input), false);
    },
    [runAction],
  );

  if (!detail || !auditDetail) return null;

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
                  onClick={() => handleOpenChange(true)}
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
        detail={auditDetail}
        tasks={taskHistory}
        open={open}
        busy={busy}
        loading={auditLoading}
        onOpenChange={handleOpenChange}
        onSelectTask={taskId => void selectAuditTask(taskId)}
        onRespondToApproval={respondToApproval}
      />
    </>
  );
}
