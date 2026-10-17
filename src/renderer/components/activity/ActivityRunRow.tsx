import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { AlertCircle, CalendarClock, CheckCircle2, ChevronDown, MessageSquare } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import React, { useEffect, useRef, useState } from 'react';

import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import { PlatformRegistry, type Platform } from '../../../shared/platform';
import { imPlatformLogo } from '../../assets/imLogos';
import { i18nService } from '../../services/i18n';
// 2026/09/23 活动失败行复用对话侧的 JSON message 提取，避免直接展示原始 payload
import { extractUserFacingErrorMessage } from '../../services/coworkTerminalError';
import type { ActivityRun } from '../../../shared/activity/types';
import { compactMarkdownClass } from '../compactMarkdownClass';
import MarkdownContent from '../MarkdownContent';
import { formatActivityClockTime, formatActivityError, formatActivityTime } from './utils';

interface ActivityRunRowProps {
  run: ActivityRun;
  /** Play the entrance spring — reserved for runs arriving while the feed is open. */
  animateEntrance: boolean;
  currentTime?: number;
}

/** Threshold height in px beyond which response content becomes expandable (approx 2 lines). */
const EXPANDABLE_THRESHOLD_PX = 46;

/** Resolve the quiet left-hand label: cron runs name the trigger, channel runs name the platform. */
const sourceLabel = (run: ActivityRun): string => {
  if (run.source === ActivitySource.ScheduledTask) {
    return run.taskName || i18nService.t('activityTriggerCron');
  }
  return run.platform ? i18nService.t(run.platform) : i18nService.t('activityTriggerChannel');
};

const ActivityRunRow: React.FC<ActivityRunRowProps> = ({ run, animateEntrance, currentTime }) => {
  const prefersReducedMotion = useReducedMotion();
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [isBodyOverflowing, setIsBodyOverflowing] = useState(false);
  const bodyTextRef = useRef<HTMLDivElement>(null);

  const isRunning = run.status === ActivityStatus.Running;
  const isFailed = run.status === ActivityStatus.Failed;
  // 进行中/成功用 replyPreview；失败先解 JSON message，再走中断码本地化
  const bodyText = isFailed
    ? formatActivityError(
        run.errorMessage ? extractUserFacingErrorMessage(run.errorMessage) : undefined,
      )
    : run.replyPreview?.trim() || '';
  const hasBody = bodyText.length > 0;
  const hasExpandableBody = hasBody && isBodyOverflowing;
  const TriggerIcon = run.source === ActivitySource.ScheduledTask ? CalendarClock : MessageSquare;
  const platform =
    run.source === ActivitySource.Channel &&
    PlatformRegistry.platforms.includes(run.platform as Platform)
      ? (run.platform as Platform)
      : null;

  useEffect(() => {
    if (!hasBody) {
      setIsBodyOverflowing(false);
      setBodyExpanded(false);
      return;
    }
    const element = bodyTextRef.current;
    if (!element) return;

    const measure = () => {
      const content = element.querySelector('.markdown-content');
      const height = content instanceof HTMLElement ? content.scrollHeight : element.scrollHeight;
      const overflowing = height > EXPANDABLE_THRESHOLD_PX;
      setIsBodyOverflowing(overflowing);
      if (!overflowing) {
        setBodyExpanded(false);
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    const content = element.querySelector('.markdown-content');
    observer.observe(content instanceof HTMLElement ? content : element);
    return () => observer.disconnect();
  }, [hasBody, bodyText]);

  const toggleBodyExpanded = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setBodyExpanded(open => {
      if (open && bodyTextRef.current) {
        bodyTextRef.current.scrollTop = 0;
      }
      return !open;
    });
  };

  const row = (
    <div
      className={cn(
        'theme-surface-activity-row group relative flex flex-col p-4 transition-all duration-200',
        isRunning && 'border-primary/40 bg-primary/[0.02]',
        isFailed && 'border-destructive/30 bg-destructive/[0.01]',
      )}
    >
      {/* Top Header Row */}
      <div className="flex items-start gap-3.5 min-w-0">
        {/* Icon Tile */}
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg border',
            isRunning
              ? 'border-primary/30 bg-primary/10 text-primary'
              : isFailed
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border/60 bg-surface-raised text-muted-foreground',
          )}
        >
          {platform ? (
            <img
              src={imPlatformLogo(platform)}
              alt={i18nService.t(platform)}
              className="size-5 rounded object-contain"
            />
          ) : (
            <TriggerIcon className="size-4" />
          )}
        </div>

        {/* Title and Meta Information */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-semibold text-foreground">
              {sourceLabel(run)}
            </span>
            <span className="inline-flex items-center rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0">
              {run.source === ActivitySource.ScheduledTask
                ? i18nService.t('activityTriggerCron')
                : i18nService.t('activityTriggerChannel')}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatActivityClockTime(run.updatedAt)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatActivityTime(run.updatedAt, currentTime)}</span>
          </div>
        </div>

        {/* Status Badge & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 px-2.5 py-0.5 text-xs font-medium',
              isRunning && 'border-primary/40 bg-primary/10 text-primary',
              isFailed && 'border-destructive/40 bg-destructive/10 text-destructive',
              !isRunning && !isFailed && 'border-success/40 bg-success/10 text-success',
            )}
          >
            {isRunning ? (
              <Spinner className="size-3 text-primary" />
            ) : isFailed ? (
              <AlertCircle className="size-3 text-destructive" />
            ) : (
              <CheckCircle2 className="size-3 text-success" />
            )}
            <span>
              {i18nService.t(
                isRunning
                  ? 'activityStatusRunning'
                  : isFailed
                    ? 'activityStatusFailed'
                    : 'activityStatusCompleted',
              )}
            </span>
          </Badge>

          {hasExpandableBody && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={toggleBodyExpanded}
              aria-expanded={bodyExpanded}
              aria-label={
                bodyExpanded ? i18nService.t('activityCollapse') : i18nService.t('activityExpand')
              }
            >
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-200 ease-out',
                  bodyExpanded && 'rotate-180',
                )}
              />
            </Button>
          )}
        </div>
      </div>

      {/* Body / Result Preview Box */}
      {hasBody && (
        <div
          className={cn(
            'mt-3 rounded-lg border border-border/50 bg-muted/20 px-3.5 py-2.5 transition-colors',
            isFailed && 'border-destructive/20 bg-destructive/5',
            hasExpandableBody && 'cursor-pointer hover:bg-muted/30',
          )}
          onClick={hasExpandableBody ? toggleBodyExpanded : undefined}
        >
          <div
            ref={bodyTextRef}
            className={cn(
              'min-w-0 overflow-hidden text-xs leading-relaxed transition-[max-height] duration-200 ease-out motion-reduce:transition-none',
              bodyExpanded ? 'max-h-96 overflow-y-auto' : 'max-h-12',
            )}
            onClick={event => {
              if ((event.target as HTMLElement).closest('a, button')) {
                event.stopPropagation();
              }
            }}
          >
            <MarkdownContent
              content={bodyText}
              className={compactMarkdownClass(isFailed ? 'destructive' : 'muted')}
            />
          </div>

          {hasExpandableBody && (
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {bodyExpanded ? i18nService.t('activityCollapse') : i18nService.t('activityExpand')}
              </span>
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform duration-200 ease-out',
                  bodyExpanded && 'rotate-180',
                )}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (prefersReducedMotion) {
    return row;
  }
  return (
    <motion.div
      initial={animateEntrance ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
    >
      {row}
    </motion.div>
  );
};

export default ActivityRunRow;
