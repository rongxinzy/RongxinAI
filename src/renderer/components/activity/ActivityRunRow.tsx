import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import { Separator } from '@shared/components/ui/separator';
import { i18nService } from '../../services/i18n';
// 2026/09/23 活动失败行复用对话侧的 JSON message 提取，避免直接展示原始 payload
import { extractUserFacingErrorMessage } from '../../services/coworkTerminalError';
import type { ActivityRun } from '../../../shared/activity/types';
import { compactMarkdownClass } from '../compactMarkdownClass';
import StaticMarkdownContent from '../markdown/StaticMarkdownContent';
import { formatActivityClockTime, formatActivityError, formatActivityTime } from './utils';

interface ActivityRunRowProps {
  run: ActivityRun;
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

const ActivityRunRow: React.FC<ActivityRunRowProps> = ({ run, currentTime }) => {
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

  return (
    <>
      <div className="grid grid-cols-[7ch_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-3">
        <time
          className="theme-control-caption-muted tabular-nums"
          dateTime={new Date(run.updatedAt).toISOString()}
          title={formatActivityTime(run.updatedAt, currentTime)}
        >
          {formatActivityClockTime(run.updatedAt)}
        </time>
        <span className="theme-heading truncate" title={sourceLabel(run)}>
          {sourceLabel(run)}
        </span>
        <Badge variant="ghost" className="gap-1">
          {isRunning ? <Spinner /> : isFailed ? <AlertCircle /> : <Check />}
          {i18nService.t(
            isRunning
              ? 'activityStatusRunning'
              : isFailed
                ? 'activityStatusFailed'
                : 'activityStatusCompleted',
          )}
        </Badge>
        {hasBody && (
          <div className="col-start-2 col-end-4 min-w-0">
            <div
              ref={bodyTextRef}
              className={cn(
                'overflow-hidden',
                bodyExpanded ? 'max-h-96 overflow-y-auto' : 'max-h-12',
              )}
            >
              <StaticMarkdownContent
                content={bodyText}
                className={compactMarkdownClass(isFailed ? 'destructive' : 'muted')}
              />
            </div>
            {hasExpandableBody && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={bodyExpanded}
                onClick={toggleBodyExpanded}
              >
                {i18nService.t(bodyExpanded ? 'activityCollapse' : 'activityExpand')}
                <ChevronDown className={cn(bodyExpanded && 'rotate-180')} />
              </Button>
            )}
          </div>
        )}
      </div>
      <Separator />
    </>
  );
};

export default ActivityRunRow;
