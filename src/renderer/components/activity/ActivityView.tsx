import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '@shared/components/ui/empty';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { cn } from '@shared/lib/utils';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import activityEmptyIcon from '../../assets/activity/activity-empty-icon.svg';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { selectActivityRuns } from '../../store/selectors/activitySelectors';
import type { ActivityRun } from '../../../shared/activity/types';
import PageHeader from '../PageHeader';
import ActivityHero from './ActivityHero';
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
  // 2026/09/15 lixiang  状态筛选默认高亮「进行中」
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
  // 2026/09/15 lixiang  清除筛选仅判断来源 Tab，不把状态筛选算作可清除条件
  const hasActiveFilters = triggerFilter !== ActivityTriggerFilter.All;
  const isFilterEmpty = hasAnyRun && dayGroups.length === 0;

  // 2026/09/15 lixiang  清除筛选条件只切回「全部」，下方状态筛选保持不变
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
      />

      {/* 2026/09/15 lixiang  内容区底部留白，避免贴边 */}
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden px-8 pb-[20px]">
        <ActivityHero />

        {/* 2026/09/15 lixiang  内容区高度：最小半屏，最大为当前可用高度，超出滚动 */}
        <section className="flex h-fit min-h-[50vh] max-h-full flex-col overflow-hidden rounded-xl border border-border shadow-sm">
          {/* Source tabs */}
          {/* 2026/09/15 lixiang  仅 Tab 行保留表面色，下半区透出页面底色 */}
          {/* 2026/09/15 lixiang  活动页来源 Tab 加高，贴近设计稿点击热区 */}
          <div className="flex h-12 shrink-0 items-center border-b border-border bg-surface px-6">
            <PageTabs
              className="h-full [&_.theme-page-tabs-list]:h-full [&_.theme-page-tabs-trigger]:h-full"
              value={triggerFilter}
              onValueChange={setTriggerFilter}
              items={triggerOptions.map(option => ({
                value: option.value,
                label: i18nService.t(option.labelKey),
              }))}
            />
          </div>

          {/* Status filter pills */}
          <div className="flex shrink-0 items-center gap-1 px-6 py-2.5">
            {statusOptions.map(option => {
              const active = statusFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setStatusFilter(active ? ActivityStatusFilter.All : option.value)
                  }
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs leading-4 transition-colors',
                    active
                      ? 'bg-primary-muted font-medium text-primary'
                      : 'font-normal text-muted-foreground hover:text-foreground',
                  )}
                >
                  {i18nService.t(option.labelKey)}
                </button>
              );
            })}
          </div>

          {/* Feed / empty */}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
            {!hasAnyRun || dayGroups.length === 0 ? (
              // 2026/09/15 lixiang  活动页空态收紧图标与文案间距，不改全局 Empty 组件
              <Empty className="min-h-[18rem] gap-2 px-6 py-20">
                <EmptyHeader className="gap-1">
                  <EmptyMedia className="mb-0 size-16 overflow-clip">
                    <img
                      src={activityEmptyIcon}
                      alt=""
                      className="size-full"
                      width={64}
                      height={64}
                      aria-hidden="true"
                    />
                  </EmptyMedia>
                  <EmptyDescription className="text-sm text-muted-foreground">
                    {i18nService.t(hasAnyRun ? 'activityFilterEmpty' : 'activityEmpty')}
                  </EmptyDescription>
                </EmptyHeader>
                {isFilterEmpty && hasActiveFilters ? (
                  <EmptyContent>
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-xs text-primary transition-colors hover:text-primary-hover"
                    >
                      {i18nService.t('activityFilterClear')}
                    </button>
                  </EmptyContent>
                ) : !hasAnyRun && onShowScheduledTasks ? (
                  <EmptyContent>
                    <button
                      type="button"
                      onClick={onShowScheduledTasks}
                      className="text-xs text-primary transition-colors hover:text-primary-hover"
                    >
                      {i18nService.t('activityEmptyAction')}
                    </button>
                  </EmptyContent>
                ) : null}
              </Empty>
            ) : (
              <div className="px-3 pb-6 pt-2">
                {dayGroups.map(group => (
                  <section key={group.label} className="pb-4">
                    <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </h2>
                    <div className="flex flex-col">
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
        </section>
      </div>
    </div>
  );
};

export default ActivityView;
