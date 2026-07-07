import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
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
  const [showMenu, setShowMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const isRunning = task.state.runningAtMs !== null;
  const displayStatus = isRunning ? 'running' : task.state.lastStatus;
  const statusLabel = i18nService.t(getStatusLabelKey(displayStatus));
  const statusTone = getStatusTone(displayStatus);

  return (
    <div
      className="grid grid-cols-[1.2fr_1fr_110px_40px] items-center gap-3 px-4 py-3 border-b border-border-subtle hover:bg-surface-raised/50 cursor-pointer transition-colors"
      onClick={() => dispatch(selectTask(task.id))}
    >
      <div className="min-w-0">
        <div className={`text-sm truncate ${task.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
          {task.name}
        </div>
        {task.description && (
          <div className="text-xs truncate text-muted-foreground">{task.description}</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="text-sm truncate text-muted-foreground">{formatScheduleLabel(task.schedule)}</div>
        {task.enabled && task.state.nextRunAtMs !== null && (
          <div className="text-xs truncate text-muted-foreground/60 mt-0.5">
            {formatNextRunRelative(task.state.nextRunAtMs)}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-medium ${statusTone}`}>{statusLabel}</span>
        <Switch
          checked={task.enabled}
          onCheckedChange={(checked: boolean) => {
            void scheduledTaskService.toggleTask(task.id, checked);
          }}
        />
      </div>

      <div className="flex justify-center">
        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={event => {
              event.stopPropagation();
              setShowMenu(value => !value);
            }}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-surface-raised transition-colors"
          >
            <EllipsisVertical className="w-5 h-5" />
          </Button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-32 rounded-lg shadow-lg bg-surface border border-border z-50 py-1">
              {task.state.runningAtMs ? (
                <span className="block w-full text-left px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400">
                  {i18nService.t('scheduledTasksStatusRunning')}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={event => {
                    event.stopPropagation();
                    setShowMenu(false);
                    void scheduledTaskService.runManually(task.id);
                  }}
                  className="w-full justify-start text-left px-3 py-1.5 text-sm text-foreground hover:bg-surface-raised"
                  title={i18nService.t('scheduledTasksRunPreemptWarning')}
                >
                  {i18nService.t('scheduledTasksRun')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={event => {
                  event.stopPropagation();
                  setShowMenu(false);
                  dispatch(selectTask(task.id));
                  dispatch(setViewMode('edit'));
                }}
                className="w-full justify-start text-left px-3 py-1.5 text-sm text-foreground hover:bg-surface-raised"
              >
                {i18nService.t('scheduledTasksEdit')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={event => {
                  event.stopPropagation();
                  setShowMenu(false);
                  onRequestDelete(task.id, task.name);
                }}
                className="w-full justify-start text-left px-3 py-1.5 text-sm text-red-500 hover:bg-surface-raised"
              >
                {i18nService.t('scheduledTasksDelete')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
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
        <Clock className="h-12 w-12 text-muted-foreground/40 mb-4" />
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
    <div>
      <div className="grid grid-cols-[1.2fr_1fr_110px_40px] items-center gap-3 px-4 py-2 border-b border-border-subtle">
        <div className="text-xs font-medium text-muted-foreground">
          {i18nService.t('scheduledTasksListColTitle')}
        </div>
        <div className="text-xs font-medium text-muted-foreground">
          {i18nService.t('scheduledTasksListColSchedule')}
        </div>
        <div className="text-xs font-medium text-muted-foreground">
          {i18nService.t('scheduledTasksListColStatus')}
        </div>
        <div className="text-xs font-medium text-muted-foreground text-center">
          {i18nService.t('scheduledTasksListColMore')}
        </div>
      </div>
      {tasks.map(task => (
        <TaskListItem key={task.id} task={task} onRequestDelete={onRequestDelete} />
      ))}
    </div>
  );
};

export default TaskList;
