import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table';
import { X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import type { RunFilter, ScheduledTaskRun } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import DateInput from './DateInput';
import FailureDetailModal from './FailureDetailModal';
import RunSessionModal from './RunSessionModal';
import { formatDateTime, formatDuration } from './utils';

interface TaskRunHistoryProps {
  taskId: string;
  runs: ScheduledTaskRun[];
  taskPrompt?: string;
}

const STATUS_OPTIONS = ['success', 'error', 'skipped'] as const;

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  success: 'default',
  error: 'destructive',
  skipped: 'outline',
};

const statusLabelKeys: Record<string, string> = {
  success: 'scheduledTasksStatusSuccess',
  error: 'scheduledTasksStatusError',
  skipped: 'scheduledTasksStatusSkipped',
};

function applyClientFilter(runs: ScheduledTaskRun[], filter: RunFilter): ScheduledTaskRun[] {
  return runs.filter(run => {
    if (filter.status && run.status !== filter.status) return false;
    if (filter.startDate && run.startedAt < filter.startDate + 'T00:00:00') return false;
    if (filter.endDate && run.startedAt > filter.endDate + 'T23:59:59') return false;
    return true;
  });
}

const EMPTY_FILTER: RunFilter = {};

const TaskRunHistory: React.FC<TaskRunHistoryProps> = ({ taskId, runs, taskPrompt }) => {
  const hasMore = useSelector(
    (state: RootState) => state.scheduledTask.runsHasMore[taskId] ?? false,
  );
  const [viewingRun, setViewingRun] = useState<ScheduledTaskRun | null>(null);
  const [viewingError, setViewingError] = useState<Pick<
    ScheduledTaskRun,
    'startedAt' | 'error'
  > | null>(null);
  const [filter, setFilter] = useState<RunFilter>(EMPTY_FILTER);

  const hasActiveFilter = Boolean(filter.startDate || filter.endDate || filter.status);

  const displayedRuns = useMemo(
    () => (hasActiveFilter ? applyClientFilter(runs, filter) : runs),
    [runs, filter, hasActiveFilter],
  );

  const loadInitial = useCallback(
    (f: RunFilter) => {
      scheduledTaskService.loadRuns(taskId, 20, 0, f);
    },
    [taskId],
  );

  useEffect(() => {
    loadInitial(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (newFilter: RunFilter) => {
    setFilter(newFilter);
    loadInitial(newFilter);
  };

  const handleClearFilter = () => {
    handleFilterChange(EMPTY_FILTER);
  };

  const handleStatusToggle = (status: string) => {
    handleFilterChange({
      ...filter,
      status: filter.status === status ? undefined : status,
    });
  };

  const handleLoadMore = async () => {
    await scheduledTaskService.loadRuns(taskId, 50, runs.length, filter);
  };

  return (
    <div>
      {/* Filter: status pills + date range */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
        <div className="flex items-center gap-1">
          {STATUS_OPTIONS.map(s => {
            const isActive = filter.status === s;
            return (
              <Badge
                key={s}
                variant={isActive ? statusVariant[s] : 'ghost'}
                className="cursor-pointer"
                onClick={() => handleStatusToggle(s)}
              >
                {i18nService.t(statusLabelKeys[s])}
              </Badge>
            );
          })}
        </div>

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

      {displayedRuns.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          {hasActiveFilter
            ? i18nService.t('scheduledTasksFilterNoResults')
            : i18nService.t('scheduledTasksNoRuns')}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{i18nService.t('scheduledTasksHistoryColTime')}</TableHead>
              <TableHead>{i18nService.t('scheduledTasksHistoryColStatus')}</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedRuns.map(run => (
              <TableRow key={run.id} className="hover:bg-muted">
                <TableCell>
                  {run.status === 'running' ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <span
                      className={`text-sm font-bold ${
                        run.status === 'success'
                          ? 'text-green-500'
                          : run.status === 'error'
                            ? 'text-destructive'
                            : 'text-yellow-500'
                      }`}
                    >
                      {run.status === 'success' ? '✓' : run.status === 'error' ? '✗' : '↷'}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-foreground">
                    {formatDateTime(new Date(run.startedAt))}
                  </span>
                </TableCell>
                <TableCell>
                  {run.durationMs !== null && (
                    <span className="text-xs text-muted-foreground ml-2">
                      {formatDuration(run.durationMs)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {run.status === 'error' && run.error && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => setViewingError(run)}
                      >
                        {i18nService.t('scheduledTasksViewFailureDetails')}
                      </Button>
                    )}
                    {(run.sessionId || run.sessionKey) && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => setViewingRun(run)}
                      >
                        {i18nService.t('scheduledTasksViewSession')}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {hasMore && (
        <Button type="button" variant="ghost" onClick={handleLoadMore} className="w-full py-2 mt-2">
          {i18nService.t('scheduledTasksLoadMore')}
        </Button>
      )}

      {viewingRun && (
        <RunSessionModal
          sessionId={viewingRun.sessionId}
          sessionKey={viewingRun.sessionKey}
          onClose={() => setViewingRun(null)}
        />
      )}

      {viewingError && (
        <FailureDetailModal
          inputCommand={taskPrompt || ''}
          error={viewingError.error || ''}
          runTime={formatDateTime(new Date(viewingError.startedAt))}
          onClose={() => setViewingError(null)}
        />
      )}
    </div>
  );
};

export default TaskRunHistory;
