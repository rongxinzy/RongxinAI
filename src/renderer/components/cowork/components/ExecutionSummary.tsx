import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import { CheckCircle2, SparklesIcon, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { i18nService } from '../../../services/i18n';
import {
  getCompletedExecutionSummaryText,
  type ExecutionSummary as ExecutionSummaryData,
} from '../helpers/executionStatus';

export const ExecutionSummary = ({
  summary,
  children,
}: {
  summary: ExecutionSummaryData | null;
  children?: ReactNode;
}) => (
  <ChainOfThought defaultOpen={false}>
    <ChainOfThoughtHeader icon={SparklesIcon}>
      {getCompletedExecutionSummaryText(summary)}
    </ChainOfThoughtHeader>
    <ChainOfThoughtContent>
      <div className="flex flex-col gap-3">
        {summary && summary.toolCalls > 0 && (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{`${summary.toolCalls} ${i18nService.t('coworkExecutionSummaryTools')}`}</span>
            {summary.completedTools > 0 && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3.5" />
                {`${summary.completedTools} ${i18nService.t('coworkExecutionSummaryCompleted')}`}
              </span>
            )}
            {summary.failedTools > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <TriangleAlert className="size-3.5" />
                {`${summary.failedTools} ${i18nService.t('coworkExecutionSummaryFailed')}`}
              </span>
            )}
            {summary.incompleteTools > 0 && (
              <span className="flex items-center gap-1 text-warning">
                <TriangleAlert className="size-3.5" />
                {`${summary.incompleteTools} ${i18nService.t('coworkExecutionSummaryIncomplete')}`}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </ChainOfThoughtContent>
  </ChainOfThought>
);
