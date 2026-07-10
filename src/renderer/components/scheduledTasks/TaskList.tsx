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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';
import { cn } from '@shared/lib/utils';
import { Clock, EllipsisVertical } from 'lucide-react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { selectTask, setViewMode } from '../../store/slices/scheduledTaskSlice';
import {
  formatNextRunRelative,
  formatScheduleLabel,
  getStatusLabelKey,
} from './utils';

// ── Status to text color mapping ──

const statusTextClass: Record<string, string> = {
  success: 'text-[var(--lobster-success)]',
  error: 'text-destructive',
  running: 'text-primary',
  skipped: 'text-muted-foreground',
};

// ── TaskListItem ──

interface TaskListItemProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
}

const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();

  const isRunning = task.state.runningAtMs !== null;
  const displayStatus = isRunning ? 'running' : task.state.lastStatus;
  const statusLabel = i18nService.t(getStatusLabelKey(displayStatus));

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted"
      onClick={() => dispatch(selectTask(task.id))}
    >
      <TableCell className="max-w-[240px] min-w-0">
        <div className={cn(
          'text-sm truncate',
          task.enabled ? 'text-foreground' : 'text-muted-foreground',
        )}>
          {task.name}
        </div>
        {task.description && (
          <div className="text-xs truncate text-muted-foreground">{task.description}</div>
        )}
      </TableCell>

      <TableCell>
        <div className="text-sm truncate text-muted-foreground">
          {formatScheduleLabel(task.schedule)}
        </div>
        {task.enabled && task.state.nextRunAtMs !== null && (
          <div className="text-xs truncate text-muted-foreground/60 mt-0.5">
            {formatNextRunRelative(task.state.nextRunAtMs)}
          </div>
        )}
      </TableCell>

      <TableCell className="w-28" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={displayStatus ? statusTextClass[displayStatus] || 'text-muted-foreground' : 'text-muted-foreground'}>
            {statusLabel}
          </Badge>
          <Switch
            checked={task.enabled}
            onCheckedChange={(checked: boolean) => {
              void scheduledTaskService.toggleTask(task.id, checked);
            }}
          />
        </div>
      </TableCell>

      <TableCell className="w-10 text-center">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" />}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {task.state.runningAtMs ? (
              <DropdownMenuItem disabled>
                {i18nService.t('scheduledTasksStatusRunning')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  void scheduledTaskService.runManually(task.id);
                }}
              >
                {i18nService.t('scheduledTasksRun')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                dispatch(selectTask(task.id));
                dispatch(setViewMode('edit'));
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
      </TableCell>
    </TableRow>
  );
};

// ── TaskList ──

interface TaskListProps {
  onRequestDelete: (taskId: string, taskName: string) => void;
}

const TaskList: React.FC<TaskListProps> = ({ onRequestDelete }) => {
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const loading = useSelector((state: RootState) => state.scheduledTask.loading);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-muted-foreground">{i18nService.t('loading')}</div>
      </div>
    );
  }

  if (tasks.length === 0) {
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
    <Card className="bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-muted-foreground">{i18nService.t('scheduledTasksListColTitle')}</TableHead>
            <TableHead className="text-muted-foreground">{i18nService.t('scheduledTasksListColSchedule')}</TableHead>
            <TableHead className="text-muted-foreground w-28">{i18nService.t('scheduledTasksListColStatus')}</TableHead>
            <TableHead className="text-muted-foreground w-10">{i18nService.t('scheduledTasksListColMore')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map(task => (
            <TaskListItem key={task.id} task={task} onRequestDelete={onRequestDelete} />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
};

export default TaskList;
