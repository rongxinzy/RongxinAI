import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card, CardContent, CardTitle } from '@shared/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Switch } from '@shared/components/ui/switch';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { CircleAlert, Clock, EllipsisVertical, RefreshCw } from 'lucide-react';
import React from 'react';
import { useSelector } from 'react-redux';

import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import {
  formatNextRunRelative,
  formatScheduleLabel,
  getStatusLabelKey,
  getStatusTextClass,
} from './utils';

// ── TaskListItem ──

interface TaskListItemProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
  onRequestEdit: (taskId: string) => void;
}

const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete, onRequestEdit }) => {
  const isRunning = task.state.runningAtMs !== null;
  const displayStatus = isRunning ? 'running' : task.state.lastStatus;
  const statusLabel = i18nService.t(getStatusLabelKey(displayStatus));
  const nextRunLabel =
    task.enabled && task.state.nextRunAtMs !== null
      ? formatNextRunRelative(task.state.nextRunAtMs)
      : null;

  return (
    <Card className="theme-page-task-list-card-1 flex-row items-center">
      <CardContent className="theme-control-sizing-4 flex min-w-0 flex-1 items-center gap-3">
        <CardTitle
          className={cn(
            'min-w-0 flex-1 truncate',
            task.enabled
              ? 'theme-page-task-list-card-title-variant-1'
              : 'theme-page-task-list-card-title-variant-2',
          )}
        >
          {task.name}
        </CardTitle>

        <div className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
          <span>{formatScheduleLabel(task.schedule)}</span>
          {nextRunLabel && <span className="text-xs text-muted-foreground/60">{nextRunLabel}</span>}
        </div>

        <Badge className={getStatusTextClass(displayStatus)} variant="outline">
          {statusLabel}
        </Badge>

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
      </CardContent>

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
    </Card>
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
      <div className="flex flex-col items-center justify-center py-16 px-6">
        <Clock className="size-12 text-muted-foreground/40 mb-4" />
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {i18nService.t('scheduledTasksEmptyState')}
        </p>
        <p className="text-xs text-muted-foreground/70 text-center">
          {i18nService.t('scheduledTasksEmptyHint')}
        </p>
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
