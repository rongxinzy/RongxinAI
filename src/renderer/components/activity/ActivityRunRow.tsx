import { cn } from '@shared/lib/utils';
import { CalendarClock, ChevronDown, MessageSquare } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import React, { useState } from 'react';

import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import { PlatformRegistry, type Platform } from '../../../shared/platform';
import { i18nService } from '../../services/i18n';
import type { ActivityRun } from '../../../shared/activity/types';
import { formatActivityClockTime } from './utils';

interface ActivityRunRowProps {
  run: ActivityRun;
  /** Play the entrance spring — reserved for runs arriving while the feed is open. */
  animateEntrance: boolean;
}

/** Resolve the quiet left-hand label: cron runs name the trigger, channel runs name the platform. */
const sourceLabel = (run: ActivityRun): string => {
  if (run.source === ActivitySource.ScheduledTask) {
    return run.taskName || i18nService.t('activityTriggerCron');
  }
  return run.platform ? i18nService.t(run.platform) : i18nService.t('activityTriggerChannel');
};

const ActivityRunRow: React.FC<ActivityRunRowProps> = ({ run, animateEntrance }) => {
  const prefersReducedMotion = useReducedMotion();
  const [errorExpanded, setErrorExpanded] = useState(false);

  const isRunning = run.status === ActivityStatus.Running;
  const isFailed = run.status === ActivityStatus.Failed;
  const hasExpandableError = isFailed && Boolean(run.errorMessage);
  const TriggerIcon = run.source === ActivitySource.ScheduledTask ? CalendarClock : MessageSquare;
  const platform =
    run.source === ActivitySource.Channel &&
    PlatformRegistry.platforms.includes(run.platform as Platform)
    ? (run.platform as Platform)
    : null;

  const row = (
    <div
      role={hasExpandableError ? 'button' : undefined}
      tabIndex={hasExpandableError ? 0 : undefined}
      aria-expanded={hasExpandableError ? errorExpanded : undefined}
      onClick={hasExpandableError ? () => setErrorExpanded(open => !open) : undefined}
      onKeyDown={
        hasExpandableError
          ? event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setErrorExpanded(open => !open);
              }
            }
          : undefined
      }
      className={cn(
        'flex gap-3 rounded-lg px-3 py-2.5 transition-colors',
        hasExpandableError && 'cursor-pointer hover:bg-surface-raised',
      )}
    >
      {/* Status: one quiet dot. Running breathes with a slow pulse. */}
      <span className="flex w-3 shrink-0 items-start justify-center pt-[7px]">
        <span className="sr-only">
          {i18nService.t(
            isRunning
              ? 'activityStatusRunning'
              : isFailed
                ? 'activityStatusFailed'
                : 'activityStatusCompleted',
          )}
        </span>
        {isRunning ? (
          <span
            className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse"
            aria-hidden="true"
          />
        ) : isFailed ? (
          <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
        ) : (
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
        )}
      </span>

      {platform ? (
        <img
          src={PlatformRegistry.logo(platform)}
          alt={i18nService.t(platform)}
          className="mt-0.5 size-4 shrink-0 rounded object-contain"
        />
      ) : (
        <TriggerIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm text-foreground">{sourceLabel(run)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatActivityClockTime(run.updatedAt)}
          </span>
        </div>
        {run.replyPreview && !isFailed && (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{run.replyPreview}</p>
        )}
        {isFailed && (
          <div className="mt-0.5 flex items-start gap-1">
            <p
              className={cn(
                'min-w-0 flex-1 text-sm text-destructive',
                !errorExpanded && 'truncate',
              )}
            >
              {run.errorMessage || i18nService.t('activityStatusFailed')}
            </p>
            {hasExpandableError && (
              <ChevronDown
                className={cn(
                  'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
                  errorExpanded && 'rotate-180',
                )}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (prefersReducedMotion) {
    return row;
  }
  // Every row is a layout-animating motion component: a newly arrived run
  // fades/slides in at the top while existing rows glide down to make room.
  return (
    <motion.div
      layout
      initial={animateEntrance ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
    >
      {row}
    </motion.div>
  );
};

export default ActivityRunRow;
