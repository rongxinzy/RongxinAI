import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import React from 'react';

import { i18nService } from '../../../services/i18n';
import type { CoworkMessage } from '../../../types/cowork';

const getThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return <span>{i18nService.t('codingAgentReasoningActive')}</span>;
  }
  if (duration === undefined) {
    return <span>{i18nService.t('reasoning')}</span>;
  }
  return (
    <span>
      {i18nService.t('localInferenceThoughtForSeconds').replace('{seconds}', String(duration))}
    </span>
  );
};

export const ThinkingBlock: React.FC<{
  message: CoworkMessage;
  mapDisplayText?: (value: string) => string;
}> = ({ message, mapDisplayText }) => {
  const isStreaming = Boolean(message.metadata?.isStreaming);
  const content = mapDisplayText ? mapDisplayText(message.content) : message.content;

  return (
    <Reasoning isStreaming={isStreaming} showConnector>
      <ReasoningTrigger getThinkingMessage={getThinkingMessage} />
      <ReasoningContent>{content}</ReasoningContent>
    </Reasoning>
  );
};
