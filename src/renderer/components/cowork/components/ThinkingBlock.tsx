import { Reasoning, ReasoningContent, ReasoningTrigger } from '@shared/components/ai-elements/reasoning';
import React from 'react';

import type { CoworkMessage } from '../../../types/cowork';

const getThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) return <p>思考中…</p>;
  if (duration === undefined) return <p>思考内容</p>;
  return <p>已思考 {duration} 秒</p>;
};

export const ThinkingBlock: React.FC<{
  message: CoworkMessage;
  mapDisplayText?: (value: string) => string;
}> = ({ message, mapDisplayText }) => {
  const isStreaming = Boolean(message.metadata?.isStreaming);
  const content = mapDisplayText ? mapDisplayText(message.content) : message.content;

  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger getThinkingMessage={getThinkingMessage} />
      <ReasoningContent>{content}</ReasoningContent>
    </Reasoning>
  );
};
