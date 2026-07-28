import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import { SparklesIcon } from 'lucide-react';
import type { ReactNode } from 'react';

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
      <div className="flex flex-col gap-3">{children}</div>
    </ChainOfThoughtContent>
  </ChainOfThought>
);
