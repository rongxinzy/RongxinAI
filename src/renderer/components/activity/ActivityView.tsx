import { PageTabs } from '@shared/components/ui/page-tabs';
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
}

/** Refresh day grouping once a minute; the feed itself is event-driven. */
const TIME_TICK_MS = 60_000;

const ActivityView: React.FC<ActivityViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const runs = useSelector((state: RootState) => selectActivityRuns(state));
  const [language, setLanguage] = useState(i18nService.getLanguage());
  const [triggerFilter, setTriggerFilter] = useState<ActivityTriggerFilter>(
    ActivityTriggerFilter.All,
  );
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>(ActivityStatusFilter.All);

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

  const statusOptions = [
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

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-8">
        {/* Hero */}
        <section className="animate-fade-in-up shrink-0 pt-8 pb-6">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-muted">
              <Activity className="size-6 text-primary" />
            </div>
            <p className="min-w-0 text-sm text-muted-foreground">
              {i18nService.t('activityHeroDesc')}
            </p>
          </div>
        </section>

        {/* Filters: trigger on the left, status on the right. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 pb-4">
          <PageTabs
            value={triggerFilter}
            onValueChange={setTriggerFilter}
            items={triggerOptions.map(option => ({
              value: option.value,
              label: i18nService.t(option.labelKey),
            }))}
          />
          <PageTabs
            value={statusFilter}
            onValueChange={setStatusFilter}
            onItemClick={value => {
              if (value === statusFilter) setStatusFilter(ActivityStatusFilter.All);
            }}
            items={statusOptions.map(option => ({
              value: option.value,
              label: i18nService.t(option.labelKey),
            }))}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
          <div className="pb-10">
            {/* Feed */}
            {!hasAnyRun || dayGroups.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">
                  {i18nService.t(hasAnyRun ? 'activityFilterEmpty' : 'activityEmpty')}
                </p>
              </div>
            ) : (
              dayGroups.map(group => (
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
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityView;
