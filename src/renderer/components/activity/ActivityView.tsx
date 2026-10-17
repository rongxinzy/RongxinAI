import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Button } from '@shared/components/ui/button';
import { Badge } from '@shared/components/ui/badge';
import { FluidTabs, FluidTabsSize } from '@shared/components/ui/fluid-tabs';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { Activity, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { selectActivityRuns } from '../../store/selectors/activitySelectors';
import type { ActivityRun } from '../../../shared/activity/types';
import PageHeader from '../PageHeader';
import ActivityRunRow from './ActivityRunRow';
import { ActivityStatusFilter, ActivityTriggerFilter } from './constants';
import { formatActivityDayLabel, tpl } from './utils';

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

  const channelCount = useMemo(
    () => runs.filter(run => run.source === ActivityTriggerFilter.Channel).length,
    [runs],
  );
  const cronCount = useMemo(
    () => runs.filter(run => run.source === ActivityTriggerFilter.Cron).length,
    [runs],
  );

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

  const triggerOptions = useMemo(
    () => [
      {
        value: ActivityTriggerFilter.All,
        label: i18nService.t('activityFilterAll'),
        badge:
          runs.length > 0 ? (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
              {runs.length}
            </Badge>
          ) : undefined,
      },
      {
        value: ActivityTriggerFilter.Channel,
        label: i18nService.t('activityTriggerChannel'),
        badge:
          channelCount > 0 ? (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
              {channelCount}
            </Badge>
          ) : undefined,
      },
      {
        value: ActivityTriggerFilter.Cron,
        label: i18nService.t('activityTriggerCron'),
        badge:
          cronCount > 0 ? (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
              {cronCount}
            </Badge>
          ) : undefined,
      },
    ],
    [runs.length, channelCount, cronCount],
  );

  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title={i18nService.t('activityTitle')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
        tabs={
          <PageTabs value={triggerFilter} onValueChange={setTriggerFilter} items={triggerOptions} />
        }
      />

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 pt-5 pb-8 sm:px-6">
          {/* Status filter toolbar with FluidTabs */}
          <div className="flex shrink-0 items-center justify-between gap-3 pb-4">
            <FluidTabs
              aria-label={i18nService.t('activityTitle')}
              size={FluidTabsSize.Small}
              value={statusFilter}
              onValueChange={setStatusFilter}
              items={statusOptions.map(option => ({
                value: option.value,
                label: i18nService.t(option.labelKey),
              }))}
            />

            {hasActiveFilters && !isFilterEmpty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
                <span>{i18nService.t('activityFilterClear')}</span>
              </Button>
            )}
          </div>

          {/* Feed / empty */}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
            {!hasAnyRun || dayGroups.length === 0 ? (
              <Empty className="min-h-[18rem] gap-2 px-6 py-20">
                <EmptyHeader className="gap-1.5">
                  <EmptyMedia className="mb-2 size-10 rounded-xl bg-surface-raised flex items-center justify-center text-muted-foreground overflow-clip border border-border/60">
                    <Activity className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>
                    {i18nService.t(hasAnyRun ? 'activityFilterEmpty' : 'activityEmpty')}
                  </EmptyTitle>
                  <EmptyDescription className="text-xs text-muted-foreground">
                    {hasAnyRun ? i18nService.t('activityHeroDesc') : ''}
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
              <div className="pb-8">
                {dayGroups.map(group => (
                  <section key={group.label} className="pb-6">
                    <div className="sticky top-0 z-10 mb-3 flex items-center gap-3 py-1.5 backdrop-blur-md bg-background/90">
                      <span className="text-xs font-semibold text-foreground tracking-wide">
                        {group.label}
                      </span>
                      <span className="h-px flex-1 bg-border/60" />
                      <span className="text-[11px] text-muted-foreground">
                        {tpl(i18nService.t('activityRunsCount'), {
                          count: String(group.runs.length),
                        })}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {group.runs.map(run => (
                        <ActivityRunRow
                          key={run.id}
                          run={run}
                          animateEntrance={run.updatedAt > openedAtRef.current}
                          currentTime={currentTime}
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
