import {
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import { SparklesIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  getCompletedExecutionSummaryText,
  type ExecutionSummary as ExecutionSummaryData,
} from '../helpers/executionStatus';
import { PersistentChainOfThought } from './PersistentCollapsible';

export const ExecutionSummary = ({
  summary,
  persistKey,
  children,
}: {
  summary: ExecutionSummaryData | null;
  /** Keeps expansion state across virtualization unmounts and export remounts. */
  persistKey: string;
  children?: ReactNode;
}) => (
  <PersistentChainOfThought persistKey={persistKey} defaultOpen={false}>
    <ChainOfThoughtHeader icon={SparklesIcon}>
      {getCompletedExecutionSummaryText(summary)}
    </ChainOfThoughtHeader>
    <ChainOfThoughtContent>
      <div className="flex flex-col gap-3">{children}</div>
    </ChainOfThoughtContent>
  </PersistentChainOfThought>
);
