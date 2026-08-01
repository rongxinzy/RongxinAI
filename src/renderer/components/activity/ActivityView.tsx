import { Button } from '@shared/components/ui/button';
import { ButtonGroup } from '@shared/components/ui/button-group';
import { Activity, PanelLeft, Pencil } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { selectActivityRuns, type ActivityRun } from '../../store/selectors/activitySelectors';
import WindowTitleBar from '../window/WindowTitleBar';
import ActivityRunRow from './ActivityRunRow';
import { ActivityStatusFilter, ActivityTriggerFilter } from './constants';
import { formatActivityDayLabel } from './utils';

interface ActivityViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

/** Refresh relative timestamps once a minute; the feed itself is event-driven. */
const TIME_TICK_MS = 60_000;

const ActivityView: React.FC<ActivityViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const isMac = window.electron.platform === 'darwin';
  const runs = useSelector((state: RootState) => selectActivityRuns(state));
  const [language, setLanguage] = useState(i18nService.getLanguage());
  const [triggerFilter, setTriggerFilter] = useState<ActivityTriggerFilter>(
    ActivityTriggerFilter.All,
  );
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>(ActivityStatusFilter.All);

  // Only runs arriving after the view opened play the entrance spring;
  // the initial render lands quietly.
  const openedAtRef = useRef(Date.now());

  // Minute tick so "N 分钟前" labels stay honest while the feed sits open.
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), TIME_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);

  const filteredRuns = useMemo(
    () =>
      runs.filter(run => {
        if (triggerFilter !== ActivityTriggerFilter.All && run.trigger !== triggerFilter) {
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header chrome — same shell as the other feature views. */}
      <div className="flex items-center justify-between pl-4">
        <div className="flex items-center gap-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <Button type="button" variant="ghost" size="icon" onClick={onToggleSidebar}>
                <PanelLeft />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={onNewChat}>
                <Pencil />
              </Button>
              {updateBadge}
            </div>
          )}
        </div>
        <WindowTitleBar inline />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-8 pb-10">
          {/* Hero */}
          <section className="animate-fade-in-up pt-8 pb-6">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-muted">
                <Activity className="size-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xxl font-semibold text-foreground">
                  {i18nService.t('activityTitle')}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {i18nService.t('activityHeroDesc')}
                </p>
              </div>
            </div>
          </section>

          {/* Filters: trigger on the left, status toggles on the right. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-4">
            <ButtonGroup>
              {triggerOptions.map(option => (
                <Button
                  key={option.value}
                  variant="outline"
                  size="sm"
                  className={
                    triggerFilter === option.value
                      ? 'bg-secondary text-foreground'
                      : 'bg-card text-muted-foreground'
                  }
                  aria-pressed={triggerFilter === option.value}
                  onClick={() => setTriggerFilter(option.value)}
                >
                  {i18nService.t(option.labelKey)}
                </Button>
              ))}
            </ButtonGroup>
            <ButtonGroup>
              {statusOptions.map(option => (
                <Button
                  key={option.value}
                  variant="outline"
                  size="sm"
                  className={
                    statusFilter === option.value
                      ? 'bg-secondary text-foreground'
                      : 'bg-card text-muted-foreground'
                  }
                  aria-pressed={statusFilter === option.value}
                  onClick={() =>
                    setStatusFilter(current =>
                      current === option.value ? ActivityStatusFilter.All : option.value,
                    )
                  }
                >
                  {i18nService.t(option.labelKey)}
                </Button>
              ))}
            </ButtonGroup>
          </div>

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
  );
};

export default ActivityView;
