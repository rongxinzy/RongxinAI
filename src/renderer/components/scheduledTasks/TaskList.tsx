import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card } from '@shared/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Switch } from '@shared/components/ui/switch';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import {
  CalendarClock,
  CircleAlert,
  EllipsisVertical,
  Folder,
  MessageCirclePlus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { getLastPathSegment } from '../../utils/path';
import { TASK_TEMPLATES, type TaskTemplateValues } from './TaskTemplateGallery';
import {
  formatDuration,
  formatNextRunRelative,
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

const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete, onRequestEdit }) => {
  const isRunning = task.state.runningAtMs !== null;
  const displayStatus = isRunning ? 'running' : task.state.lastStatus;
  const statusLabel = i18nService.t(getStatusLabelKey(displayStatus));
  const nextRunLabel = task.enabled
    ? formatNextRunRelative(computeNextRunAtMs(task.schedule, Date.now()))
    : null;
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
    <Card className="theme-page-task-list-card-1 flex flex-col gap-2 p-3 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-8 rounded-lg bg-surface-raised flex items-center justify-center shrink-0 text-muted-foreground">
          <CalendarClock className="size-4" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'truncate text-sm font-medium',
                task.enabled
                  ? 'theme-page-task-list-card-title-variant-1'
                  : 'theme-page-task-list-card-title-variant-2',
              )}
            >
              {task.name}
            </span>
            {workspaceName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 rounded px-1.5 py-0.5 bg-muted/60">
                <Folder className="size-3" />
                <span className="truncate max-w-[120px]">{workspaceName}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{formatScheduleLabel(task.schedule)}</span>
            {nextRunLabel && <span>· {nextRunLabel}</span>}
            {task.state.lastDurationMs !== null && (
              <span>· {formatDuration(task.state.lastDurationMs)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge className={getStatusTextClass(displayStatus)} variant="outline">
            {statusLabel}
          </Badge>

          {deliveryFailure !== null && (
            <Badge
              variant="outline"
              className={cn('shrink-0', getStatusTextClass('error'))}
              title={deliveryFailure || i18nService.t('scheduledTasksDeliveryFailed')}
            >
              {i18nService.t('scheduledTasksDeliveryFailed')}
            </Badge>
          )}

          <div
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            className="shrink-0"
          >
            <Switch
              checked={task.enabled}
              onCheckedChange={(checked: boolean) => {
                void scheduledTaskService.toggleTask(task.id, checked);
              }}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="shrink-0" />}
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

      {displayText && (
        <p className="text-xs text-muted-foreground/80 line-clamp-1 pl-11 pr-2">{displayText}</p>
      )}
    </Card>
  );
};

// ── TaskList ──

interface TaskListProps {
  onRequestDelete: (taskId: string, taskName: string) => void;
  onRequestEdit: (taskId: string) => void;
  onCreateTask?: () => void;
  onCreateByChat?: () => void;
  onSelectTemplate?: (values: TaskTemplateValues) => void;
}

const TaskList: React.FC<TaskListProps> = ({
  onRequestDelete,
  onRequestEdit,
  onCreateTask,
  onCreateByChat,
  onSelectTemplate,
}) => {
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
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="size-10 rounded-xl bg-surface-raised flex items-center justify-center text-muted-foreground mb-3">
          <CalendarClock className="size-5" />
        </div>
        <h3 className="text-base font-semibold text-foreground mb-1">
          {i18nService.t('scheduledTasksEmptyState')}
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mb-5">
          {i18nService.t('scheduledTasksEmptyHint')}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2.5 mb-8">
          {onCreateTask && (
            <Button type="button" size="sm" onClick={onCreateTask} className="gap-1.5">
              <Plus className="size-4" />
              <span>{i18nService.t('scheduledTasksNewTask')}</span>
            </Button>
          )}
          {onCreateByChat && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCreateByChat}
              className="gap-1.5"
            >
              <MessageCirclePlus className="size-4" />
              <span>{i18nService.t('scheduledTasksCreateByChat')}</span>
            </Button>
          )}
        </div>

        {onSelectTemplate && (
          <div className="w-full max-w-xl text-left border-t border-border-subtle pt-6">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {i18nService.t('taskTemplateSectionTitle')}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {TASK_TEMPLATES.map(tpl => (
                <button
                  type="button"
                  key={tpl.id}
                  onClick={() =>
                    onSelectTemplate({
                      name: i18nService.t(tpl.nameKey as Parameters<typeof i18nService.t>[0]),
                      description: i18nService.t(
                        tpl.descKey as Parameters<typeof i18nService.t>[0],
                      ),
                      schedule: tpl.schedule,
                      promptText: i18nService.t(
                        tpl.promptTextKey as Parameters<typeof i18nService.t>[0],
                      ),
                    })
                  }
                  className="group flex flex-col justify-between p-3 rounded-lg border border-border bg-card hover:bg-surface-raised cursor-pointer text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-2.5 mb-2">
                    <div className="size-7 rounded-md bg-surface-raised flex items-center justify-center text-muted-foreground shrink-0 group-hover:text-foreground">
                      <tpl.icon className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">
                        {i18nService.t(tpl.nameKey as Parameters<typeof i18nService.t>[0])}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-1">
                        {i18nService.t(tpl.descKey as Parameters<typeof i18nService.t>[0])}
                      </div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                    <CalendarClock className="size-3" />
                    {i18nService.t(tpl.scheduleLabelKey as Parameters<typeof i18nService.t>[0])}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {loadErrorAlert}
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
