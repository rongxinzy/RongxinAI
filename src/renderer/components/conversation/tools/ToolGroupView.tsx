import { Steps, StepsContent, StepsItem, StepsTrigger } from '@shared/components/conversation';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { CheckCircle2, Search } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../../services/i18n';
import type { ToolGroupTurnPart } from '../model/types';
import { getToolDisplayName, getToolInputSummary } from './toolFormatters';
import { ToolPartView } from './ToolPartView';

export interface ToolGroupViewProps {
  group: ToolGroupTurnPart;
  forceExpand?: boolean;
}

/**
 * Collapses consecutive read-only exploration tool calls into a compact
 * Steps timeline inspired by prompt-kit ChainOfThought / Steps.
 */
export const ToolGroupView: React.FC<ToolGroupViewProps> = React.memo(
  ({ group, forceExpand = false }) => {
    const [open, setOpen] = useState(false);
    const activePart = [...group.parts]
      .reverse()
      .find(part => part.phase === 'running' || part.phase === 'input-streaming');
    const isRunning = Boolean(activePart);
    const latestSummary = activePart
      ? [
          getToolDisplayName(activePart.toolName),
          getToolInputSummary(activePart.toolName, activePart.input),
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

    const label = isRunning
      ? [i18nService.t('coworkStepsExploring'), latestSummary].filter(Boolean).join(' · ')
      : i18nService.t('coworkStepsExploredCount').replace('{count}', String(group.parts.length));

    return (
      <Steps open={forceExpand || open} onOpenChange={setOpen}>
        <StepsTrigger
          data-slot="tool"
          data-tool-state={isRunning ? 'input-available' : 'output-available'}
          leftIcon={
            isRunning ? (
              <Search className="theme-conversation-icon" />
            ) : (
              <CheckCircle2 className="theme-conversation-icon" />
            )
          }
        >
          {isRunning ? (
            <Shimmer as="span" duration={1.5}>
              {label}
            </Shimmer>
          ) : (
            <span>{label}</span>
          )}
        </StepsTrigger>
        <StepsContent>
          {group.parts.map(part => (
            <StepsItem key={part.id}>
              <ToolPartView part={part} forceExpand={forceExpand} />
            </StepsItem>
          ))}
        </StepsContent>
      </Steps>
    );
  },
);

ToolGroupView.displayName = 'ToolGroupView';
