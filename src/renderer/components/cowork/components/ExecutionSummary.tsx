import {
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
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
  active = false,
  children,
}: {
  summary: ExecutionSummaryData | null;
  /** Keeps expansion state across virtualization unmounts and export remounts. */
  persistKey: string;
  /**
   * The turn is still working. This row can sit on screen unchanged for a long
   * time (waiting on thinking or a tool), so the running shimmer is what tells a
   * stall apart from a finished turn (issue #133).
   */
  active?: boolean;
  children?: ReactNode;
}) => {
  const label = getCompletedExecutionSummaryText(summary);
  return (
    <PersistentChainOfThought persistKey={persistKey} defaultOpen={false}>
      <ChainOfThoughtHeader icon={SparklesIcon}>
        {active ? <Shimmer duration={1.5}>{label}</Shimmer> : label}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        <div className="flex flex-col gap-3">{children}</div>
      </ChainOfThoughtContent>
    </PersistentChainOfThought>
  );
};
