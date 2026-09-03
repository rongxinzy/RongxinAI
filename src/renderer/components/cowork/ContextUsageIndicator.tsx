import {
  ContextUsageState,
  getContextUsageState,
} from '@shared/components/ai-elements/context';
import { Button } from '@shared/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { i18nService } from '../../services/i18n';
import type { CoworkContextUsage, CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import { formatTokenCount } from '../../utils/tokenFormat';

interface ContextUsageIndicatorProps {
  usage: CoworkContextUsage | undefined;
  messageUsage?: CoworkMessageMetadata['usage'];
  modelId?: string;
  modelProviderKey?: string;
  selectedModelId?: string;
  selectedModelProviderKey?: string;
  messages?: CoworkMessage[];
  systemPrompt?: string;
}

const estimateTokens = (text: string): number => Math.max(0, Math.round(text.length / 4));

export function ContextUsageIndicator({
  usage,
  messageUsage,
  modelId,
  modelProviderKey,
  selectedModelId,
  selectedModelProviderKey,
  messages = [],
  systemPrompt = '',
}: ContextUsageIndicatorProps) {
  // A fresh conversation has no runtime measurement yet. Keep the toolbar
  // clean until the first assistant response provides an actual snapshot.
  if (!usage) return null;
  if (
    selectedModelId &&
    (modelId !== selectedModelId ||
      (modelProviderKey &&
        selectedModelProviderKey &&
        modelProviderKey !== selectedModelProviderKey))
  ) {
    return null;
  }

  const hasUsage =
    Number.isFinite(usage.usedTokens) &&
    Number.isFinite(usage.contextWindowTokens) &&
    usage.usedTokens >= 0 &&
    usage.contextWindowTokens > 0;
  const usedTokens = hasUsage ? Math.max(0, usage?.usedTokens ?? 0) : 0;
  const totalTokens = hasUsage ? (usage?.contextWindowTokens ?? 0) : 0;
  const remainingTokens = hasUsage ? Math.max(0, totalTokens - usedTokens) : 0;
  const percent = hasUsage ? Math.min((usedTokens / totalTokens) * 100, 100) : 0;
  const usageState = getContextUsageState(usedTokens, totalTokens);
  const usageStateClassName =
    usageState === ContextUsageState.Critical
      ? 'text-destructive'
      : usageState === ContextUsageState.Warning
        ? 'text-warning'
        : '';
  if (!hasUsage) return null;

  const summary = i18nService
    .t('coworkContextUsageSummary')
    .replace('{used}', formatTokenCount(usedTokens))
    .replace('{total}', formatTokenCount(totalTokens))
    .replace('{remaining}', formatTokenCount(remainingTokens));

  const circumference = 2 * Math.PI * 8;
  const dashOffset = circumference * (1 - percent / 100);
  const estimatedSystemTokens = estimateTokens(systemPrompt);
  const estimatedToolTokens = messages
    .filter(message => message.type === 'tool_use' || message.type === 'tool_result')
    .reduce((total, message) => total + estimateTokens(message.content), 0);
  const estimatedMessageTokens = messages
    .filter(message => message.type === 'user' || message.type === 'assistant')
    .reduce((total, message) => total + estimateTokens(message.content), 0);
  const rows = [
    [i18nService.t('coworkContextUsageSystem'), estimatedSystemTokens, 'var(--zy-text-secondary)'],
    [i18nService.t('coworkContextUsageTools'), estimatedToolTokens, 'var(--zy-model-tag-violet-foreground)'],
    [i18nService.t('coworkContextUsageMessages'), estimatedMessageTokens, 'var(--zy-skill-blue-foreground)'],
  ] as const;
  const estimatedTotal = rows.reduce((total, [, tokens]) => total + tokens, 0);
  const usedBarWidth = `${percent}%`;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              nativeButton={true}
              render={
                <Button type="button" variant="ghost" size="icon-sm" aria-label={summary}>
                  <span className="sr-only">{summary}</span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className={usageStateClassName}>
                    <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                    <circle
                      cx="10"
                      cy="10"
                      r="8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                    />
                  </svg>
                </Button>
              }
            />
          }
        />
        <TooltipContent>{summary}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-72 max-w-[calc(100vw-2rem)] gap-3 p-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className={`font-medium ${usageStateClassName}`}>{percent.toFixed(1)}%</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatTokenCount(usedTokens)} / {formatTokenCount(totalTokens)}
          </span>
        </div>
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
          aria-label={summary}
          role="img"
        >
          <div className="flex h-full min-w-0" style={{ width: usedBarWidth }}>
            {rows.map(([, tokens, color]) => (
              <span
                key={color}
                className="h-full min-w-0 first:rounded-l-full last:rounded-r-full"
                style={{
                  backgroundColor: color,
                  minWidth: tokens > 0 && estimatedTotal > 0 ? '2px' : undefined,
                  width: estimatedTotal > 0 ? `${(tokens / estimatedTotal) * 100}%` : undefined,
                }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-1.5 border-t border-border pt-2 text-sm">
          {rows.map(([label, tokens, color]) => (
            <div key={label} className="flex min-w-0 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{label}</span>
              </span>
              <span className="shrink-0 tabular-nums">~{formatTokenCount(tokens)}</span>
            </div>
          ))}
          {!messageUsage ? <p className="text-xs leading-normal text-muted-foreground">{summary}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
