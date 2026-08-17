import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CoworkMessage } from '../../types/cowork';
import { i18nService } from '../../services/i18n';
import {
  formatCompactTokenCount,
  formatDuration,
  formatTokenRate,
  getSessionStats,
} from './sessionStats';

interface SessionStatsLineProps {
  messages: CoworkMessage[];
}

export function SessionStatsLine({ messages }: SessionStatsLineProps) {
  const stats = getSessionStats(messages);
  const groups: string[] = [];
  if (stats.turns > 0 || stats.steps > 0) {
    groups.push(i18nService.t('coworkStatsCounts')
      .replace('{turns}', String(stats.turns))
      .replace('{steps}', String(stats.steps)));
  }
  const durations = [
    stats.llmDurationMs === null ? null : i18nService.t('coworkStatsLlm').replace('{duration}', formatDuration(stats.llmDurationMs) ?? ''),
    stats.toolDurationMs === null ? null : i18nService.t('coworkStatsTool').replace('{duration}', formatDuration(stats.toolDurationMs) ?? ''),
  ].filter((value): value is string => value !== null);
  if (durations.length) groups.push(durations.join(' · '));
  const performance = [
    stats.ttftAverageMs === null ? null : i18nService.t('coworkStatsTtft').replace('{duration}', formatDuration(stats.ttftAverageMs) ?? ''),
    stats.throughputTokensPerSecond === null ? null : formatTokenRate(stats.throughputTokensPerSecond),
  ].filter((value): value is string => value !== null);
  if (performance.length) groups.push(performance.join(' · '));
  if (stats.cacheHitPercent !== null) {
    groups.push(i18nService.t('coworkStatsCache').replace('{percent}', String(Math.round(stats.cacheHitPercent))));
  }
  if (stats.inputTokens !== null || stats.outputTokens !== null) {
    groups.push(i18nService.t('coworkStatsTokens')
      .replace('{input}', formatCompactTokenCount(stats.inputTokens) ?? '-')
      .replace('{output}', formatCompactTokenCount(stats.outputTokens) ?? '-'));
  }
  const line = groups.join(' | ');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [line]);
  if (!line) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        disabled={!truncated}
        render={<div ref={rootRef} className="w-full truncate px-4 pt-1 text-center text-xs leading-5 text-muted-foreground" />}
      >
        {line}
      </TooltipTrigger>
      <TooltipContent>{line}</TooltipContent>
    </Tooltip>
  );
}
