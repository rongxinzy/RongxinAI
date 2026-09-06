import { Button } from '@shared/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Skeleton } from '@shared/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { Activity, Check, Play, RefreshCw, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'sonner';

import {
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchApprovalResponseInput,
  type WorkbenchTask,
  type WorkbenchTaskActionResult,
  type WorkbenchTaskDetail,
} from '../../../shared/workbenchTask';
import { i18nService } from '../../services/i18n';
import type { AppDispatch } from '../../store';
import { setActiveArtifactProjection } from '../../store/slices/artifactSlice';
import { WorkbenchTaskAuditView } from './workbenchTaskAudit/WorkbenchTaskAuditView';
import { getProjectedRun } from './workbenchTaskAudit/utils';

interface WorkbenchTaskTrajectoryProps {
  sessionId?: string;
  active: boolean;
  loadingOverride?: boolean;
  onBackToConversation: () => void;
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

export function WorkbenchTaskTrajectory({
  sessionId,
  active,
  loadingOverride = false,
  onBackToConversation,
}: WorkbenchTaskTrajectoryProps) {
  const dispatch = useDispatch<AppDispatch>();
  const [detail, setDetail] = useState<WorkbenchTaskDetail | null>(null);
  const [auditDetail, setAuditDetail] = useState<WorkbenchTaskDetail | null>(null);
  const [taskHistory, setTaskHistory] = useState<WorkbenchTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(Boolean(sessionId));
  const [auditLoading, setAuditLoading] = useState(false);
  const activeRef = useRef(active);
  const wasActiveRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const applyDetail = useCallback(
    (nextDetail: WorkbenchTaskDetail | null) => {
      setDetail(nextDetail);
      setAuditDetail(current => {
        if (!nextDetail) return null;
        return !current || current.task.id === nextDetail.task.id ? nextDetail : current;
      });
      if (!sessionId) return;
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

  const loadCurrent = useCallback(async () => {
    if (!sessionId) return;
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
    if (!sessionId) return;
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

  useEffect(() => {
    applyDetail(null);
    setTaskHistory([]);
    if (!sessionId) {
      setInitialLoading(false);
      return;
    }

    setInitialLoading(true);
    let disposed = false;
    void loadCurrent().finally(() => {
      if (!disposed) setInitialLoading(false);
    });
    const unsubscribe = window.electron.workbenchTask.onChanged(event => {
      if (event.sessionId !== sessionId) return;
      void loadCurrent();
      if (activeRef.current) void loadTaskHistory();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [applyDetail, loadCurrent, loadTaskHistory, sessionId]);

  useEffect(() => {
    if (active) void loadTaskHistory();
  }, [active, loadTaskHistory]);

  useEffect(() => {
    if (active && !wasActiveRef.current) setAuditDetail(detail);
    wasActiveRef.current = active;
  }, [active, detail]);

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

  if (loadingOverride || initialLoading) return <WorkbenchTaskTrajectorySkeleton />;

  if (!detail || !auditDetail) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Activity />
          </EmptyMedia>
          <EmptyTitle>{i18nService.t('coworkTraceEmptyTitle')}</EmptyTitle>
          <EmptyDescription>{i18nService.t('coworkTraceEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={onBackToConversation}>
            {i18nService.t('coworkBackToConversation')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <WorkbenchTaskAuditView
      detail={auditDetail}
      tasks={taskHistory}
      busy={busy}
      loading={auditLoading}
      onSelectTask={taskId => void selectAuditTask(taskId)}
      onRespondToApproval={respondToApproval}
      toolbarActions={
        <TooltipProvider>
          <div className="flex items-center gap-1">
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
      }
    />
  );
}

function WorkbenchTaskTrajectorySkeleton() {
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6">
        <div className="flex flex-col gap-3 pt-8 pb-6">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="relative flex flex-col gap-6">
          <span aria-hidden="true" className="absolute inset-y-0 left-3.5 w-px bg-border" />
          {[0, 1, 2, 3, 4].map(index => (
            <div key={index} className="relative pl-10">
              <Skeleton className="theme-scene-trajectory-loading absolute top-0 left-0" />
              <div className="flex flex-col gap-2 pt-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
