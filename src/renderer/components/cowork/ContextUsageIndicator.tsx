import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
  ContextUsageState,
  getContextUsageState,
} from '@shared/components/ai-elements/context';
import { i18nService } from '../../services/i18n';
import type { CoworkContextUsage, CoworkMessageMetadata } from '../../types/cowork';
import { formatTokenCount } from '../../utils/tokenFormat';

interface ContextUsageIndicatorProps {
  usage: CoworkContextUsage | undefined;
  messageUsage?: CoworkMessageMetadata['usage'];
  modelId?: string;
}

export function ContextUsageIndicator({
  usage,
  messageUsage,
  modelId,
}: ContextUsageIndicatorProps) {
  // A fresh conversation has no runtime measurement yet. Keep the toolbar
  // clean until the first assistant response provides an actual snapshot.
  if (!usage) return null;

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

  return (
    <Context
      usedTokens={usedTokens}
      maxTokens={totalTokens}
      modelId={modelId}
      usage={
        messageUsage
          ? {
              cachedInputTokens: messageUsage.cacheReadTokens,
              inputTokens: messageUsage.inputTokens,
              outputTokens: messageUsage.outputTokens,
              reasoningTokens: messageUsage.reasoningTokens,
              totalTokens: messageUsage.totalTokens,
            }
          : undefined
      }
    >
      <ContextTrigger
        aria-label={summary}
        className="h-8 shrink-0 bg-secondary px-2 text-foreground hover:bg-secondary"
      />
      <ContextContent align="end">
        <ContextContentHeader>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className={`font-medium ${usageStateClassName}`}>{percent.toFixed(1)}%</span>
            <span className="font-mono text-muted-foreground">
              {formatTokenCount(usedTokens)} / {formatTokenCount(totalTokens)}
            </span>
          </div>
        </ContextContentHeader>
        <ContextContentBody className="space-y-1.5">
          <ContextInputUsage label={i18nService.t('coworkContextUsageInput')} />
          <ContextOutputUsage label={i18nService.t('coworkContextUsageOutput')} />
          <ContextReasoningUsage label={i18nService.t('coworkContextUsageReasoning')} />
          {!messageUsage ? <p className="text-xs text-muted-foreground">{summary}</p> : null}
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}
