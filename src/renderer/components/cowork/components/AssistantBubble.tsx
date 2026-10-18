import { CoworkContentNotice } from './CoworkContentNotice';
import { Message, MessageContent } from '@shared/components/ai-elements/message';
import React, { useState } from 'react';

import type { CoworkMessage, CoworkMessageMetadata } from '../../../types/cowork';
import { formatMessageDateTime } from '../../../utils/tokenFormat';
import ImagePreviewModal, { type ImagePreviewSource } from '../ImagePreviewModal';
import { StreamingMarkdownResponse } from './StreamingMarkdownResponse';
import { useLiveMessageText } from '../../../services/useLiveMessageText';

const getMessageModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? model.split('/').pop() || model : model;
};

export const AssistantBubble: React.FC<{
  message: CoworkMessage;
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  turnMetadata?: CoworkMessageMetadata | null;
}> = ({ message, mapDisplayText, resolveLocalFilePath, turnMetadata }) => {
  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const isStreaming = Boolean(message.metadata?.isStreaming);
  const liveContent = useLiveMessageText(message.id, isStreaming);
  // While streaming the body lives in the LiveTextStore; Redux only carries
  // the committed content after the final update.
  const displayContent = (isStreaming ? liveContent : undefined) ?? message.content;
  const rawContent = mapDisplayText ? mapDisplayText(displayContent) : displayContent;
  const modelLabel = getMessageModelLabel(turnMetadata);

  // S7: an empty streaming bubble is only a placeholder for text that has not
  // arrived yet; render nothing instead of an empty shell.
  if (rawContent.trim().length === 0) return null;

  return (
    <div className="py-1 focus:outline-none">
      <Message from="assistant">
        <MessageContent
          data-assistant-plaintext={rawContent}
          data-assistant-streaming={isStreaming ? 'true' : 'false'}
        >
          {/* 2026/09/20 lixiang  下传本地路径解析，使盘符路径可点打开（issue #805） */}
          <StreamingMarkdownResponse
            content={rawContent}
            isStreaming={isStreaming}
            resolveLocalFilePath={resolveLocalFilePath}
          />
          <CoworkContentNotice truncated={message.metadata?.contentTruncated} />
        </MessageContent>
      </Message>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{formatMessageDateTime(message.timestamp)}</span>
        {modelLabel && <span>{modelLabel}</span>}
      </div>
      {expandedImage && (
        <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />
      )}
    </div>
  );
};
