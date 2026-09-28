import { cn } from '@shared/lib/utils';
import { CalendarClock, ChevronDown, MessageSquare } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import React, { useEffect, useRef, useState } from 'react';

import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import { PlatformRegistry, type Platform } from '../../../shared/platform';
import { i18nService } from '../../services/i18n';
// 2026/09/23 活动失败行复用对话侧的 JSON message 提取，避免直接展示原始 payload
import { extractUserFacingErrorMessage } from '../../services/coworkTerminalError';
import type { ActivityRun } from '../../../shared/activity/types';
import { compactMarkdownClass } from '../compactMarkdownClass';
import MarkdownContent from '../MarkdownContent';
import { formatActivityClockTime, formatActivityError } from './utils';

interface ActivityRunRowProps {
  run: ActivityRun;
  /** Play the entrance spring — reserved for runs arriving while the feed is open. */
  animateEntrance: boolean;
}

/** text-sm + leading-5 / max-h-5 — one-line budget for overflow detection */
const ACTIVITY_BODY_LINE_PX = 20;

/** Resolve the quiet left-hand label: cron runs name the trigger, channel runs name the platform. */
const sourceLabel = (run: ActivityRun): string => {
  if (run.source === ActivitySource.ScheduledTask) {
    return run.taskName || i18nService.t('activityTriggerCron');
  }
  return run.platform ? i18nService.t(run.platform) : i18nService.t('activityTriggerChannel');
};

const ActivityRunRow: React.FC<ActivityRunRowProps> = ({ run, animateEntrance }) => {
  const prefersReducedMotion = useReducedMotion();
  const [bodyExpanded, setBodyExpanded] = useState(false);
  // 仅当正文固有高度超过一行时才可展开
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
      // 量 markdown 内容固有高度，避免 line-clamp / 外层 max-height 干扰
      const content = element.querySelector('.markdown-content');
      const height = content instanceof HTMLElement ? content.scrollHeight : element.scrollHeight;
      const overflowing = height > ACTIVITY_BODY_LINE_PX + 1;
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

  const toggleBodyExpanded = () => {
    setBodyExpanded(open => {
      // 收起时归零滚动，避免 line-clamp 裁到中间一段
      if (open && bodyTextRef.current) {
        bodyTextRef.current.scrollTop = 0;
      }
      return !open;
    });
  };

  const row = (
    <div
      role={hasExpandableBody ? 'button' : undefined}
      tabIndex={hasExpandableBody ? 0 : undefined}
      aria-expanded={hasExpandableBody ? bodyExpanded : undefined}
      onClick={hasExpandableBody ? toggleBodyExpanded : undefined}
      onKeyDown={
        hasExpandableBody
          ? event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleBodyExpanded();
              }
            }
          : undefined
      }
      className={cn(
        'theme-surface-activity-row flex gap-3 px-3 py-2.5',
        hasExpandableBody && 'theme-surface-activity-expandable cursor-pointer',
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
        {hasBody && (
          <div className="mt-0.5 flex items-start gap-1">
            {/* 收起限高一行；展开可滚动。不用 truncate(nowrap)，以兼容 Markdown 块级结构。 */}
            <div
              ref={bodyTextRef}
              className={cn(
                'min-w-0 flex-1 overflow-hidden',
                'transition-[max-height] duration-200 ease-out motion-reduce:transition-none',
                bodyExpanded ? 'max-h-64 overflow-y-auto' : 'max-h-5',
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
              <ChevronDown
                className={cn(
                  'mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none',
                  bodyExpanded && 'rotate-180',
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
  // 仅新 run 入场做 opacity/y；不使用 layout，避免展开正文时兄弟行弹簧位移发飘
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
