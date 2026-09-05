import { Message, MessageContent } from '@shared/components/ai-elements/message';
import React, { useState } from 'react';

import type { CoworkMessage, CoworkMessageMetadata } from '../../../types/cowork';
import ImagePreviewModal, { type ImagePreviewSource } from '../ImagePreviewModal';
import { CopyButton } from './CopyButton';
import { StreamingMarkdownResponse } from './StreamingMarkdownResponse';

const getMessageModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? model.split('/').pop() || model : model;
};

export const AssistantBubble: React.FC<{
  message: CoworkMessage;
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showCopyButton?: boolean;
  turnMetadata?: CoworkMessageMetadata | null;
}> = ({ message, mapDisplayText, showCopyButton = false, turnMetadata }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const rawContent = mapDisplayText ? mapDisplayText(message.content) : message.content;
  const isStreaming = Boolean(message.metadata?.isStreaming);
  const modelLabel = getMessageModelLabel(turnMetadata);

  return (
    <div
      className="py-1 focus:outline-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Message from="assistant">
        <MessageContent>
          <StreamingMarkdownResponse content={rawContent} isStreaming={isStreaming} />
        </MessageContent>
      </Message>
      {modelLabel && (
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>{modelLabel}</span>
        </div>
      )}
      {showCopyButton && (
        <div className="flex items-center gap-1 mt-2">
          <CopyButton content={message.content} visible={isHovered} />
        </div>
      )}
      {expandedImage && (
        <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />
      )}
    </div>
  );
};
