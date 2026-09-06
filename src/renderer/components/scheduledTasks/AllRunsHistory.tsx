import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Spinner } from '@shared/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';
import { Clock, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import type {
  RunFilter,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
} from '../../../scheduledTask/types';
import { cn } from '@shared/lib/utils';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState, store } from '../../store';
import DateInput from './DateInput';
import FailureDetailModal from './FailureDetailModal';
import RunSessionModal from './RunSessionModal';
import { formatDateTime, formatDuration, getStatusTextClass } from './utils';

const statusLabelKeys: Record<string, string> = {
  success: 'scheduledTasksStatusSuccess',
  error: 'scheduledTasksStatusError',
  skipped: 'scheduledTasksStatusSkipped',
  running: 'scheduledTasksStatusRunning',
};

function applyClientFilter(
  runs: ScheduledTaskRunWithName[],
  filter: RunFilter,
): ScheduledTaskRunWithName[] {
  return runs.filter(run => {
    if (filter.status && run.status !== filter.status) return false;
    if (filter.startDate && run.startedAt < filter.startDate + 'T00:00:00') return false;
    if (filter.endDate && run.startedAt > filter.endDate + 'T23:59:59') return false;
    return true;
  });
}

const EMPTY_FILTER: RunFilter = {};
const EMPTY_TASK_RUNS: ScheduledTaskRun[] = [];

interface AllRunsHistoryProps {
  task?: ScheduledTask;
  /** Show the in-flight "running" status (filter chip + rows). Default true.
   *  The per-task detail view passes false: a running entry is redundant with the
   *  task's live status card shown above the history. */
  showRunning?: boolean;
}

const AllRunsHistory: React.FC<AllRunsHistoryProps> = ({ task, showRunning = true }) => {
  const allRuns = useSelector((state: RootState) => state.scheduledTask.allRuns);
  const allRunsHasMore = useSelector((state: RootState) => state.scheduledTask.allRunsHasMore);
  const taskRuns = useSelector((state: RootState) =>
    task ? (state.scheduledTask.runs[task.id] ?? EMPTY_TASK_RUNS) : EMPTY_TASK_RUNS,
  );
  const taskRunsHasMore = useSelector((state: RootState) =>
    task ? (state.scheduledTask.runsHasMore[task.id] ?? false) : false,
  );
  const [viewingRun, setViewingRun] = useState<ScheduledTaskRunWithName | null>(null);
  const [viewingError, setViewingError] = useState<ScheduledTaskRunWithName | null>(null);
  const [filter, setFilter] = useState<RunFilter>(EMPTY_FILTER);
  const taskId = task?.id;
  const taskPayload = task
    ? task.payload.kind === 'systemEvent'
      ? task.payload.text
      : task.payload.message
    : undefined;

  const runs = useMemo<ScheduledTaskRunWithName[]>(
    () =>
      task
        ? taskRuns.map(run => ({
            ...run,
            taskName: task.name,
            taskPayload,
          }))
        : allRuns,
    [allRuns, task, taskPayload, taskRuns],
  );
  const hasMore = task ? taskRunsHasMore : allRunsHasMore;

  const hasActiveFilter = Boolean(filter.startDate || filter.endDate || filter.status);

  const displayedRuns = useMemo(
    () => (hasActiveFilter ? applyClientFilter(runs, filter) : runs),
    [filter, hasActiveFilter, runs],
  );

  const loadInitial = useCallback(
    (f: RunFilter) => {
      if (taskId) {
        void scheduledTaskService.loadRuns(taskId, 50, 0, f);
        return;
      }
      void scheduledTaskService.loadAllRuns(50, 0, f);
    },
    [taskId],
  );

  useEffect(() => {
    setFilter(EMPTY_FILTER);
    // Cache-aware: switching tabs remounts this panel; skip the refetch when
    // the store already holds runs so tab switches stay instant.
    const state = store.getState().scheduledTask;
    const hasCached = taskId ? (state.runs[taskId]?.length ?? 0) > 0 : state.allRuns.length > 0;
    if (!hasCached) {
      loadInitial(EMPTY_FILTER);
    }
  }, [loadInitial, taskId]);

  const handleFilterChange = (newFilter: RunFilter) => {
    setFilter(newFilter);
    loadInitial(newFilter);
  };

  const handleClearFilter = () => {
    handleFilterChange(EMPTY_FILTER);
  };

  const handleLoadMore = () => {
    if (taskId) {
      void scheduledTaskService.loadRuns(taskId, 50, runs.length, filter);
      return;
    }
    void scheduledTaskService.loadAllRuns(50, runs.length, filter);
  };

  const handleRowClick = (run: ScheduledTaskRunWithName) => {
    if (run.sessionId || run.sessionKey) {
      setViewingRun(run);
    } else if (run.status === 'error' && run.error) {
      setViewingError(run);
    }
  };

  const isEmpty = displayedRuns.length === 0;

  return (
    <ScrollArea className="theme-scene-history min-h-0 flex-1">
      <div>
        {/* Filter area */}
        <div className="pt-3 pb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <FluidTabs
            aria-label={i18nService.t('scheduledTasksFilterStatus')}
            value={filter.status ?? ''}
            onValueChange={status =>
              handleFilterChange({ ...filter, status: status || undefined })
            }
            items={(['success', 'error', 'skipped', 'running'] as const)
              .filter(s => showRunning || s !== 'running')
              .map(s => ({ value: s as string, label: i18nService.t(statusLabelKeys[s]) }))}
          />

          <div className="flex items-center gap-1.5 ml-auto">
            <DateInput
              value={filter.startDate ?? ''}
              max={filter.endDate}
              onChange={v => handleFilterChange({ ...filter, startDate: v || undefined })}
              placeholder={i18nService.t('scheduledTasksFilterStartDate')}
            />
            <span className="text-xs text-muted-foreground">–</span>
            <DateInput
              value={filter.endDate ?? ''}
              min={filter.startDate}
              onChange={v => handleFilterChange({ ...filter, endDate: v || undefined })}
              placeholder={i18nService.t('scheduledTasksFilterEndDate')}
            />
            {hasActiveFilter && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleClearFilter}
                className="size-6"
                title={i18nService.t('scheduledTasksFilterClear')}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <Clock className="size-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">
              {hasActiveFilter
                ? i18nService.t('scheduledTasksFilterNoResults')
                : i18nService.t('scheduledTasksHistoryEmpty')}
            </p>
          </div>
        )}

        {/* Run rows */}
        {!isEmpty && (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="theme-scene-history-head-start w-1/3">
                  {i18nService.t('scheduledTasksHistoryColTitle')}
                </TableHead>
                <TableHead className="theme-scene-history-head-center w-1/3 text-center">
                  {i18nService.t('scheduledTasksHistoryColTime')}
                </TableHead>
                <TableHead className="theme-scene-history-head-end w-1/3 text-right">
                  <span className="ml-auto block w-14 text-center">
                    {i18nService.t('scheduledTasksHistoryColStatus')}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedRuns.map(run => {
                const hasSession = run.sessionId || run.sessionKey;
                const isClickable = hasSession || (run.status === 'error' && run.error);
                return (
                  <TableRow
                    key={run.id}
                    className={isClickable ? 'theme-scene-history-row cursor-pointer' : 'theme-scene-history-row'}
                    onClick={() => handleRowClick(run)}
                  >
                    <TableCell className="w-1/3 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-foreground truncate">{run.taskName}</span>
                        {showRunning && run.status === 'running' && (
                          <Spinner className="size-3 text-primary" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="w-1/3 text-center">
                      <span className="text-sm text-muted-foreground">
                        {formatDateTime(new Date(run.startedAt))}
                      </span>
                      {run.durationMs !== null && (
                        <span className="ml-1.5 text-xs text-muted-foreground/70">
                          ({formatDuration(run.durationMs)})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="w-1/3 text-right">
                      <Badge
                        variant="outline"
                        className={cn('w-14 justify-center', getStatusTextClass(run.status))}
                      >
                        {i18nService.t(statusLabelKeys[run.status] || '')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {hasMore && (
          <Button type="button" variant="ghost" onClick={handleLoadMore} className="theme-control-sizing-27 w-full">
            {i18nService.t('scheduledTasksLoadMore')}
          </Button>
        )}

        {viewingRun && (
          <RunSessionModal
            sessionId={viewingRun.sessionId}
            sessionKey={viewingRun.sessionKey}
            title={viewingRun.taskName}
            onClose={() => setViewingRun(null)}
          />
        )}

        {viewingError && (
          <FailureDetailModal
            inputCommand={viewingError.taskPayload || viewingError.taskName}
            error={viewingError.error || ''}
            taskName={viewingError.taskName}
            runTime={formatDateTime(new Date(viewingError.startedAt))}
            onClose={() => setViewingError(null)}
          />
        )}
      </div>
    </ScrollArea>
  );
};

export default AllRunsHistory;
