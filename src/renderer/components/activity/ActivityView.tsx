import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '@shared/components/ui/empty';
import { Button } from '@shared/components/ui/button';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { cn } from '@shared/lib/utils';
import { Activity } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { selectActivityRuns } from '../../store/selectors/activitySelectors';
import type { ActivityRun } from '../../../shared/activity/types';
import PageHeader from '../PageHeader';
import ActivityRunRow from './ActivityRunRow';
import { ActivityStatusFilter, ActivityTriggerFilter } from './constants';
import { formatActivityDayLabel } from './utils';

interface ActivityViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  /** Entry point offered by the empty state; the host owns view switching. */
  onShowScheduledTasks?: () => void;
}

/** Refresh day grouping once a minute; the feed itself is event-driven. */
const TIME_TICK_MS = 60_000;

const ActivityView: React.FC<ActivityViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  onShowScheduledTasks,
}) => {
  const runs = useSelector((state: RootState) => selectActivityRuns(state));
  const [language, setLanguage] = useState(i18nService.getLanguage());
  const [triggerFilter, setTriggerFilter] = useState<ActivityTriggerFilter>(
    ActivityTriggerFilter.All,
  );
  // 状态筛选默认高亮「进行中」
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>(
    ActivityStatusFilter.Started,
  );

  // Only runs arriving after the view opened play the entrance spring;
  // the initial render lands quietly.
  const openedAtRef = useRef(Date.now());

  // Keep day grouping current while the feed remains open.
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), TIME_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);

  const filteredRuns = useMemo(
    () =>
      runs.filter(run => {
        if (triggerFilter !== ActivityTriggerFilter.All && run.source !== triggerFilter) {
          return false;
        }
        if (statusFilter !== ActivityStatusFilter.All && run.status !== statusFilter) {
          return false;
        }
        return true;
      }),
    [runs, triggerFilter, statusFilter],
  );

  const dayGroups = useMemo(() => {
    const groups: { label: string; runs: ActivityRun[] }[] = [];
    for (const run of filteredRuns) {
      const label = formatActivityDayLabel(run.updatedAt, currentTime, language);
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.runs.push(run);
      } else {
        groups.push({ label, runs: [run] });
      }
    }
    return groups;
  }, [currentTime, filteredRuns, language]);

  const hasAnyRun = runs.length > 0;
  // 清除筛选仅判断来源 Tab，不把状态筛选算作可清除条件
  const hasActiveFilters = triggerFilter !== ActivityTriggerFilter.All;
  const isFilterEmpty = hasAnyRun && dayGroups.length === 0;

  // 清除筛选条件只切回「全部」，下方状态筛选保持不变
  const clearFilters = () => {
    setTriggerFilter(ActivityTriggerFilter.All);
  };

  const statusOptions = [
    { value: ActivityStatusFilter.All, labelKey: 'activityFilterAll' },
    { value: ActivityStatusFilter.Started, labelKey: 'activityStatusRunning' },
    { value: ActivityStatusFilter.Completed, labelKey: 'activityStatusCompleted' },
    { value: ActivityStatusFilter.Failed, labelKey: 'activityStatusFailed' },
  ] as const;

  const triggerOptions = [
    { value: ActivityTriggerFilter.All, labelKey: 'activityFilterAll' },
    { value: ActivityTriggerFilter.Channel, labelKey: 'activityTriggerChannel' },
    { value: ActivityTriggerFilter.Cron, labelKey: 'activityTriggerCron' },
  ] as const;

  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title={i18nService.t('activityTitle')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
        tabs={
          <PageTabs
            value={triggerFilter}
            onValueChange={setTriggerFilter}
            items={triggerOptions.map(option => ({
              value: option.value,
              label: i18nService.t(option.labelKey),
            }))}
          />
        }
      />

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 pt-4 pb-8 sm:px-6">
          {/* Status filter pills */}
          <div className="flex shrink-0 items-center justify-between gap-2 pb-3">
            <div className="flex items-center gap-1.5">
              {statusOptions.map(option => {
                const active = statusFilter === option.value;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={active ? 'secondary' : 'ghost'}
                    size="xs"
                    onClick={() =>
                      setStatusFilter(active ? ActivityStatusFilter.All : option.value)
                    }
                    className={cn('rounded-full', active && 'font-medium')}
                  >
                    {i18nService.t(option.labelKey)}
                  </Button>
                );
              })}
            </div>
            {hasActiveFilters && !isFilterEmpty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {i18nService.t('activityFilterClear')}
              </Button>
            )}
          </div>

          {/* Feed / empty */}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
            {!hasAnyRun || dayGroups.length === 0 ? (
              <Empty className="min-h-[18rem] gap-2 px-6 py-20">
                <EmptyHeader className="gap-1">
                  <EmptyMedia className="mb-2 size-10 rounded-xl bg-surface-raised flex items-center justify-center text-muted-foreground overflow-clip">
                    <Activity className="size-5" />
                  </EmptyMedia>
                  <EmptyDescription className="text-sm text-muted-foreground">
                    {i18nService.t(hasAnyRun ? 'activityFilterEmpty' : 'activityEmpty')}
                  </EmptyDescription>
                </EmptyHeader>
                {isFilterEmpty && hasActiveFilters ? (
                  <EmptyContent>
                    <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                      {i18nService.t('activityFilterClear')}
                    </Button>
                  </EmptyContent>
                ) : !hasAnyRun && onShowScheduledTasks ? (
                  <EmptyContent>
                    <Button type="button" size="sm" onClick={onShowScheduledTasks}>
                      {i18nService.t('activityEmptyAction')}
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            ) : (
              <div className="pb-6">
                {dayGroups.map(group => (
                  <section key={group.label} className="pb-4">
                    <h2 className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </h2>
                    <div className="flex flex-col gap-1.5">
                      {group.runs.map(run => (
                        <ActivityRunRow
                          key={run.id}
                          run={run}
                          animateEntrance={run.updatedAt > openedAtRef.current}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityView;
