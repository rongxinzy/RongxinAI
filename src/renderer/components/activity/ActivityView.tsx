import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { Activity, ChevronDown } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
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
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>(ActivityStatusFilter.All);

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
  const isFilterEmpty = hasAnyRun && dayGroups.length === 0;
  const clearFilters = () => {
    setTriggerFilter(ActivityTriggerFilter.All);
    setStatusFilter(ActivityStatusFilter.All);
  };

  const statusOptions = [
    { value: ActivityStatusFilter.All, labelKey: 'activityAllStatuses' },
    { value: ActivityStatusFilter.Started, labelKey: 'activityStatusRunning' },
    { value: ActivityStatusFilter.Completed, labelKey: 'activityStatusCompleted' },
    { value: ActivityStatusFilter.Failed, labelKey: 'activityStatusFailed' },
  ] as const;

  const triggerOptions = [
    { value: ActivityTriggerFilter.All, label: i18nService.t('activityFilterAll') },
    { value: ActivityTriggerFilter.Channel, label: i18nService.t('activityTriggerChannel') },
    { value: ActivityTriggerFilter.Cron, label: i18nService.t('activityTriggerCron') },
  ];
  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        title={i18nService.t('activityTitle')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
              {i18nService.t(statusOptions.find(option => option.value === statusFilter)!.labelKey)}
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
                {statusOptions.map(option => (
                  <DropdownMenuRadioItem closeOnClick key={option.value} value={option.value}>
                    {i18nService.t(option.labelKey)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        tabs={
          <PageTabs value={triggerFilter} onValueChange={setTriggerFilter} items={triggerOptions} />
        }
      />

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 pt-5 pb-8 sm:px-6">
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
                  <EmptyDescription>{i18nService.t('activityHeroDesc')}</EmptyDescription>
                </EmptyHeader>
                {isFilterEmpty ? (
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
                    <h2 className="theme-control-caption-muted mb-2">{group.label}</h2>
                    <div className="flex flex-col">
                      {group.runs.map(run => (
                        <ActivityRunRow key={run.id} run={run} currentTime={currentTime} />
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
