import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { Pencil, Play, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { setViewMode } from '../../store/slices/scheduledTaskSlice';
import TaskRunHistory from './TaskRunHistory';
import {
  formatDateTime,
  formatDeliveryLabel,
  formatDuration,
  formatScheduleLabel,
  getStatusLabelKey,
  getStatusTone,
} from './utils';

interface TaskDetailProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();
  const runs = useSelector((state: RootState) => state.scheduledTask.runs[task.id] ?? []);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const [preflight, setPreflight] = useState<{
    hasChannel: boolean;
    channel?: string;
    lastDeliveryErrors?: string[] | null;
    consecutiveErrors?: number;
  } | null>(null);

  useEffect(() => {
    void scheduledTaskService.loadRuns(task.id);
  }, [task.id]);

  useEffect(() => {
    void scheduledTaskService.preflight(task.id).then(setPreflight);
  }, [task.id]);

  const statusLabel = i18nService.t(getStatusLabelKey(task.state.lastStatus));
  const statusTone = getStatusTone(task.state.lastStatus);
  const promptText = task.payload.kind === 'systemEvent' ? task.payload.text : task.payload.message;
  const taskModelRef = task.payload.kind === 'agentTurn' ? task.payload.model : undefined;
  const taskModelLabel = taskModelRef
    ? (() => {
        const bareId = taskModelRef.includes('/')
          ? taskModelRef.slice(taskModelRef.indexOf('/') + 1)
          : taskModelRef;
        return availableModels.find(m => m.id === bareId)?.name ?? bareId;
      })()
    : undefined;

  const sectionClass = 'rounded-lg border border-border p-4';
  const sectionTitleClass = 'text-sm font-semibold text-foreground mb-3';
  const labelClass = 'text-xs text-muted-foreground';
  const valueClass = 'text-sm text-foreground';

  return (
    <div className="py-4 flex flex-col gap-4 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground truncate" title={task.name}>
            {task.name}
          </h2>
          {task.description && (
            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
              {task.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => dispatch(setViewMode('edit'))}
            title={i18nService.t('scheduledTasksEdit')}
          >
            <Pencil />
          </Button>
          {task.state.runningAtMs ? (
            <Badge variant="secondary" className="gap-1">
              <Spinner className="size-3" />
              {i18nService.t('scheduledTasksStatusRunning')}
            </Badge>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void scheduledTaskService.runManually(task.id)}
              title={i18nService.t('scheduledTasksRunPreemptWarning')}
            >
              <Play />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRequestDelete(task.id, task.name)}
            className="text-destructive hover:bg-destructive/10"
            title={i18nService.t('scheduledTasksDelete')}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksPrompt')}</h3>
        <div className="text-sm text-foreground whitespace-pre-wrap bg-secondary rounded-md p-3">
          {promptText}
        </div>
      </div>

      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksConfiguration')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksSchedule')}</div>
            <div className={valueClass}>{formatScheduleLabel(task.schedule)}</div>
          </div>
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksDetailNotify')}</div>
            <div className={valueClass}>{formatDeliveryLabel(task.delivery)}</div>
          </div>
          {taskModelLabel && (
            <div>
              <div className={labelClass}>{i18nService.t('scheduledTasksDetailModel')}</div>
              <div className={valueClass}>{taskModelLabel}</div>
            </div>
          )}
          {task.sessionKey && (
            <div className="col-span-2">
              <div className={labelClass}>{i18nService.t('scheduledTasksSessionKey')}</div>
              <div className={`${valueClass} font-mono text-xs break-all`}>{task.sessionKey}</div>
            </div>
          )}
        </div>
      </div>

      {preflight?.hasChannel &&
        preflight.lastDeliveryErrors &&
        preflight.lastDeliveryErrors.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-destructive">
                Channel delivery issue detected
              </span>
            </div>
            <p className="mt-1 text-xs text-destructive/80">{preflight.lastDeliveryErrors[0]}</p>
          </div>
        )}

      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksStatus')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksLastRun')}</div>
            <div className={`${valueClass} ${statusTone}`}>
              {statusLabel}
              {task.state.lastRunAtMs && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({formatDateTime(new Date(task.state.lastRunAtMs))})
                </span>
              )}
            </div>
          </div>
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksNextRun')}</div>
            <div className={valueClass}>
              {task.state.nextRunAtMs ? formatDateTime(new Date(task.state.nextRunAtMs)) : '-'}
            </div>
          </div>
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksLastDuration')}</div>
            <div className={valueClass}>{formatDuration(task.state.lastDurationMs)}</div>
          </div>
          <div>
            <div className={labelClass}>{i18nService.t('scheduledTasksConsecutiveErrors')}</div>
            <div className={valueClass}>{task.state.consecutiveErrors}</div>
          </div>
        </div>
        {task.state.lastError && (
          <div className="mt-3 px-3 py-2 text-xs text-destructive bg-destructive/10 rounded">
            {task.state.lastError}
          </div>
        )}
      </div>

      <div className={sectionClass}>
        <h3 className={sectionTitleClass}>{i18nService.t('scheduledTasksRunHistory')}</h3>
        <TaskRunHistory taskId={task.id} runs={runs} taskPrompt={promptText} />
      </div>
    </div>
  );
};

export default TaskDetail;
