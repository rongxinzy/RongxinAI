import { useMemo } from 'react';
import { Button } from '@shared/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@shared/components/ui/popover';
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
  const stats = useMemo(() => getSessionStats(messages), [messages]);
  const hasCounts = stats.turns > 0 || stats.steps > 0;
  const metrics = [
    ['coworkStatsTurns', hasCounts ? String(stats.turns) : null],
    ['coworkStatsSteps', hasCounts ? String(stats.steps) : null],
    ['coworkStatsModelDuration', formatDuration(stats.llmDurationMs)],
    ['coworkStatsToolDuration', formatDuration(stats.toolDurationMs)],
    ['coworkStatsFirstResponse', formatDuration(stats.ttftAverageMs)],
    ['coworkStatsSpeed', formatTokenRate(stats.throughputTokensPerSecond)],
    [
      'coworkStatsCacheHit',
      stats.cacheHitPercent === null ? null : `${Math.round(stats.cacheHitPercent)}%`,
    ],
    ['coworkStatsInputTokens', formatCompactTokenCount(stats.inputTokens)],
    ['coworkStatsOutputTokens', formatCompactTokenCount(stats.outputTokens)],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  if (!metrics.length) return null;
  return (
    <div className="flex justify-center pt-1">
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
          {i18nService.t('coworkStatsTitle')}
        </PopoverTrigger>
        <PopoverContent side="top" className="max-w-full gap-3" data-testid="session-run-info">
          <PopoverTitle>{i18nService.t('coworkStatsTitle')}</PopoverTitle>
          <dl className="grid gap-2">
            {metrics.map(([key, value]) => (
              <div key={key} className="flex min-w-0 justify-between gap-4">
                <dt className="theme-field-description min-w-0 wrap-anywhere">
                  {i18nService.t(key)}
                </dt>
                <dd className="shrink-0">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="theme-field-description">{i18nService.t('aiGeneratedDisclaimer')}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
