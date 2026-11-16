import { Message, MessageContent } from '@shared/components/ai-elements/message';
import { StreamingMarkdownResponse } from '@shared/components/ai-elements/streamingMarkdownResponse';
import { Alert, AlertDescription } from '@shared/components/ui/alert';
import React from 'react';

import { i18nService } from '../../../services/i18n';
import { useLiveMessageText } from '../../../services/useLiveMessageText';
import type { TextTurnPart } from '../model/types';

interface AssistantTextPartViewProps {
  part: TextTurnPart;
  cwd?: string;
}

/**
 * Renders an assistant markdown segment inside `.group.is-assistant > .theme-message-body`,
 * subscribing exclusively to its own message ID in LiveTextStore while streaming.
 */
export const AssistantTextPartView: React.FC<AssistantTextPartViewProps> = React.memo(
  ({ part, cwd }) => {
    const liveContent = useLiveMessageText(part.message.id, part.isStreaming);
    const displayContent =
      (part.isStreaming ? liveContent : undefined) ?? part.message.content ?? '';

    if (displayContent.trim().length === 0) return null;

    return (
      <div className="focus:outline-none" data-conversation-anchor={`message:${part.message.id}`}>
        <Message from="assistant">
          <MessageContent>
            <StreamingMarkdownResponse
              content={displayContent}
              isStreaming={part.isStreaming}
              cwd={cwd}
            />
            {part.message.metadata?.contentTruncated ? (
              <Alert role="note">
                <AlertDescription>{i18nService.t('coworkContentTruncated')}</AlertDescription>
              </Alert>
            ) : null}
          </MessageContent>
        </Message>
      </div>
    );
  },
);

AssistantTextPartView.displayName = 'AssistantTextPartView';
