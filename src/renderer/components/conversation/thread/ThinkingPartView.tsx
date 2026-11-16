import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import React from 'react';

import { i18nService } from '../../../services/i18n';
import { useLiveMessageText } from '../../../services/useLiveMessageText';
import type { ReasoningTurnPart } from '../model/types';

interface ThinkingPartViewProps {
  part: ReasoningTurnPart;
}

/**
 * Renders a reasoning block using native Streamdown streaming and collapsed
 * settled presentation, reading live deltas from LiveTextStore while active.
 */
export const ThinkingPartView: React.FC<ThinkingPartViewProps> = React.memo(({ part }) => {
  const liveContent = useLiveMessageText(part.message.id, part.isStreaming);
  const content = (part.isStreaming ? liveContent : undefined) ?? part.message.content ?? '';
  if (!content.trim() && !part.isStreaming) return null;

  return (
    <Reasoning
      isStreaming={part.isStreaming}
      defaultOpen={part.isStreaming}
      autoClose
      showConnector
      duration={part.durationSeconds}
    >
      <ReasoningTrigger
        getThinkingMessage={(streaming, duration) => {
          const seconds = duration ?? part.durationSeconds;
          if (streaming) {
            return (
              <Shimmer as="span" duration={1.5}>
                {i18nService.t('codingAgentReasoningActive')}
              </Shimmer>
            );
          }
          const key =
            part.isComplete && seconds
              ? 'localInferenceThoughtForSeconds'
              : part.isComplete
                ? 'codingAgentReasoningComplete'
                : 'reasoning';
          return <span>{i18nService.t(key).replace('{seconds}', String(seconds ?? 0))}</span>;
        }}
      />
      <ReasoningContent>{content}</ReasoningContent>
    </Reasoning>
  );
});

ThinkingPartView.displayName = 'ThinkingPartView';
