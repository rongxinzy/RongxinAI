import {
  ContextUsageGauge,
  ContextUsageState,
  getContextUsageState,
} from '@shared/components/ai-elements/context';
import { Button } from '@shared/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { useMemo } from 'react';
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

const estimateToolMessageTokens = (message: CoworkMessage): number => {
  if (message.content) return estimateTokens(message.content);
  const toolInput = message.metadata?.toolInput;
  if (toolInput != null) {
    try {
      return estimateTokens(JSON.stringify(toolInput));
    } catch {
      return 0;
    }
  }
  const fallback = message.metadata?.toolResult ?? message.metadata?.error;
  return typeof fallback === 'string' ? estimateTokens(fallback) : 0;
};

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
  const { estimatedSystemTokens, estimatedToolTokens, estimatedMessageTokens } = useMemo(() => {
    let toolTokens = 0;
    let messageTokens = 0;
    for (const message of messages) {
      if (message.type === 'tool_use' || message.type === 'tool_result') {
        toolTokens += estimateToolMessageTokens(message);
      } else if (message.type === 'user' || message.type === 'assistant') {
        messageTokens += estimateTokens(message.content);
      }
    }
    return {
      estimatedSystemTokens: estimateTokens(systemPrompt),
      estimatedToolTokens: toolTokens,
      estimatedMessageTokens: messageTokens,
    };
  }, [messages, systemPrompt]);

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

  const rows = [
    [i18nService.t('coworkContextUsageSystem'), estimatedSystemTokens, 'var(--zy-text-secondary)'],
    [i18nService.t('coworkContextUsageTools'), estimatedToolTokens, 'var(--primary)'],
    [i18nService.t('coworkContextUsageMessages'), estimatedMessageTokens, 'var(--foreground)'],
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
                  <ContextUsageGauge
                    usedTokens={usedTokens}
                    maxTokens={totalTokens}
                    className={usageStateClassName}
                  />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{summary}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        className="theme-control-sizing-10 w-72 max-w-[calc(100vw-2rem)] gap-3"
      >
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
          {!messageUsage ? (
            <p className="text-xs leading-normal text-muted-foreground">{summary}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
