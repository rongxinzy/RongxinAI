import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/components/ui/empty';
import { Separator } from '@shared/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Switch } from '@shared/components/ui/switch';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { CircleAlert, EllipsisVertical, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { getLastPathSegment } from '../../utils/path';
import {
  formatDuration,
  formatScheduleLabel,
  getStatusLabelKey,
  getStatusTextClass,
} from './utils';
import { computeNextRunAtMs } from './nextRun';

// ── TaskListItem ──

interface TaskListItemProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
  onRequestEdit: (taskId: string) => void;
}

/**
 * Last notification failure of a task, or null.
 *
 * A Run can succeed while its push silently fails, and the run history shows
 * no delivery column, so the task card has to report it.
 */
const DELIVERY_RECHECK_DELAYS_MS = [3000, 10000];

function useDeliveryFailure(task: ScheduledTask): string | null {
  const deliverable = task.delivery.mode === 'announce' && Boolean(task.delivery.channel);
  const lastRunAtMs = task.state.lastRunAtMs;
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!deliverable) {
      setFailure(null);
      return;
    }
    let cancelled = false;
    const check = () => {
      void scheduledTaskService.preflight(task.id).then(result => {
        if (cancelled) return;
        const latest = result?.latestDelivery;
        setFailure(latest && latest.status === 'error' ? latest.error || '' : null);
      });
    };
    check();
    // The finished Run is published before the channel round trip persists its
    // Delivery, so re-check while that call is still in flight.
    const timers = DELIVERY_RECHECK_DELAYS_MS.map(delay => setTimeout(check, delay));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [deliverable, lastRunAtMs, task.id]);

  return failure;
}

const taskRowLayout =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 @min-[44rem]:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5rem]';
const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete, onRequestEdit }) => {
  const isRunning = task.state.runningAtMs !== null;
  const displayStatus = isRunning ? 'running' : task.state.lastStatus;
  const statusLabel = i18nService.t(getStatusLabelKey(displayStatus));
  const nextRun = task.enabled ? computeNextRunAtMs(task.schedule, Date.now()) : null;
  const deliveryFailure = useDeliveryFailure(task);

  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const workspace = task.workspaceId ? workspaces.find(w => w.id === task.workspaceId) : undefined;
  const workspaceName = workspace
    ? getLastPathSegment(workspace.path) || workspace.name
    : undefined;

  const promptPreview =
    task.payload.kind === 'agentTurn' ? task.payload.message : task.payload.text;
  const displayText = task.description || promptPreview;

  return (
    <>
      <div className={taskRowLayout}>
        <div className="min-w-0">
          <div className="theme-heading truncate" title={task.name}>
            {task.name}
          </div>
          {displayText && (
            <div className="theme-control-caption-muted truncate" title={displayText}>
              {displayText}
            </div>
          )}
          {workspaceName && (
            <div className="theme-control-caption-muted truncate">{workspaceName}</div>
          )}
        </div>
        <div className="col-span-full min-w-0 break-words @min-[44rem]:col-span-1">
          {formatScheduleLabel(task.schedule)}
        </div>
        <div className="theme-control-caption-muted tabular-nums">
          <span className="@min-[44rem]:hidden">{i18nService.t('scheduledTasksNextRun')} · </span>
          {nextRun === null
            ? '—'
            : new Date(nextRun).toLocaleString(i18nService.getLanguage(), {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1 @min-[44rem]:justify-start">
          <span className={getStatusTextClass(displayStatus)}>{statusLabel}</span>
          {task.state.lastDurationMs !== null && (
            <span className="theme-control-caption-muted">
              {formatDuration(task.state.lastDurationMs)}
            </span>
          )}
          {deliveryFailure !== null && (
            <Badge
              variant="outline"
              className={cn('shrink-0', getStatusTextClass('error'))}
              title={deliveryFailure || i18nService.t('scheduledTasksDeliveryFailed')}
            >
              {i18nService.t('scheduledTasksDeliveryFailed')}
            </Badge>
          )}
        </div>
        <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 @min-[44rem]:col-auto @min-[44rem]:row-auto">
          <Switch
            aria-label={i18nService.t('scheduledTasksToggleTask').replace('{name}', task.name)}
            checked={task.enabled}
            onCheckedChange={(checked: boolean) => {
              void scheduledTaskService.toggleTask(task.id, checked);
            }}
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={i18nService.t('scheduledTasksActions').replace('{name}', task.name)}
                />
              }
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="theme-control-card-surface">
              {task.state.runningAtMs ? (
                <DropdownMenuItem disabled>
                  {i18nService.t('scheduledTasksStatusRunning')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="theme-control-muted"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    void scheduledTaskService.runManually(task.id);
                  }}
                >
                  {i18nService.t('scheduledTasksRun')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="theme-control-muted"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onRequestEdit(task.id);
                }}
              >
                {i18nService.t('scheduledTasksEdit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onRequestDelete(task.id, task.name);
                }}
              >
                {i18nService.t('scheduledTasksDelete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Separator />
    </>
  );
};

// ── TaskList ──

interface TaskListProps {
  onRequestDelete: (taskId: string, taskName: string) => void;
  onRequestEdit: (taskId: string) => void;
}

const TaskList: React.FC<TaskListProps> = ({ onRequestDelete, onRequestEdit }) => {
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const loading = useSelector((state: RootState) => state.scheduledTask.loading);
  const listError = useSelector((state: RootState) => state.scheduledTask.listError);

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Spinner />
        <span>{i18nService.t('loading')}</span>
      </div>
    );
  }

  const loadErrorAlert = listError ? (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{i18nService.t('scheduledTasksLoadFailed')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{listError}</span>
        <Button variant="outline" size="sm" onClick={() => void scheduledTaskService.loadTasks()}>
          <RefreshCw data-icon="inline-start" />
          {i18nService.t('tryAgain')}
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;

  if (tasks.length === 0 && !listError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{i18nService.t('scheduledTasksEmptyState')}</EmptyTitle>
          <EmptyDescription>{i18nService.t('scheduledTasksEmptyHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="@container">
      {loadErrorAlert}
      {tasks.length > 0 && (
        <div
          className={cn(taskRowLayout, 'theme-control-caption-muted hidden @min-[44rem]:grid')}
          aria-hidden="true"
        >
          {[
            'scheduledTasksFormName',
            'scheduledTasksSchedule',
            'scheduledTasksNextRun',
            'scheduledTasksStatus',
            'scheduledTasksEnabled',
          ].map(key => (
            <span key={key}>{i18nService.t(key)}</span>
          ))}
        </div>
      )}
      {tasks.map(task => (
        <TaskListItem
          key={task.id}
          task={task}
          onRequestDelete={onRequestDelete}
          onRequestEdit={onRequestEdit}
        />
      ))}
    </div>
  );
};

export default TaskList;
