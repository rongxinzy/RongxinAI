import { Button } from '@shared/components/ui/button';
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
  getStatusTone,
} from './utils';

interface TaskListItemProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
}

const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();

  const isRunning = task.state.runningAtMs !== null;
  const displayStatus = isRunning ? 'running' : task.state.lastStatus;
  const statusLabel = i18nService.t(getStatusLabelKey(displayStatus));
  const statusTone = getStatusTone(displayStatus);

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => dispatch(selectTask(task.id))}
    >
      <TableCell className="max-w-[240px] min-w-0">
        <div className={`text-sm truncate ${task.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
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

      <TableCell className="w-28">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs font-medium ${statusTone}`}>{statusLabel}</span>
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{i18nService.t('scheduledTasksListColTitle')}</TableHead>
          <TableHead>{i18nService.t('scheduledTasksListColSchedule')}</TableHead>
          <TableHead className="w-28">{i18nService.t('scheduledTasksListColStatus')}</TableHead>
          <TableHead className="w-10">{i18nService.t('scheduledTasksListColMore')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map(task => (
          <TaskListItem key={task.id} task={task} onRequestDelete={onRequestDelete} />
        ))}
      </TableBody>
    </Table>
  );
};

export default TaskList;
