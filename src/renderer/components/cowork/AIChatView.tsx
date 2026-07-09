import { type UIMessage, type UseChatHelpers } from '@ai-sdk/react';
import { Conversation, ConversationContent, ConversationScrollButton } from '@shared/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@shared/components/ai-elements/prompt-input';
import { StopCircle } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useChatChat } from '../../hooks/useChatChat';
import { i18nService } from '../../services/i18n';

export interface AIChatViewProps {
  /** Initial messages to restore a previous conversation (continue session). */
  initialMessages?: UIMessage[];
}

/**
 * AI SDK-driven chat view for chat mode.
 *
 * Thin component — useChatChat() owns all state, ai-elements render it.
 * No Redux, no manual message management.
 */
export const AIChatView: React.FC<AIChatViewProps> = ({ initialMessages }) => {
  const chat = useChatChat();
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!didInitRef.current && initialMessages?.length) {
      chat.setMessages(initialMessages);
      didInitRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);
  return <AIChatViewInner chat={chat} placeholder={i18nService.t('chatPlaceholder')} />;
};

/** Shared inner component so it can be reused with different transports later. */
export const AIChatViewInner: React.FC<{
  chat: UseChatHelpers<UIMessage> & { stop?: () => void };
  placeholder?: string;
}> = ({ chat, placeholder = 'Type a message...' }) => {
  const { messages, sendMessage, status, stop, error } = chat;
  const [input, setInput] = useState('');
  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || status !== 'ready') return;
    sendMessage({ text });
    setInput('');
  }, [input, status, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const getText = (m: UIMessage) =>
    m.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('');

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-[800px] px-4 py-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center py-20">
              <p className="text-sm text-muted-foreground">{placeholder}</p>
            </div>
          )}
          {messages.map((m: UIMessage) => (
            <Message key={m.id} from={m.role === 'user' ? 'user' : 'assistant'}>
              <MessageContent>
                {m.role === 'assistant' ? (
                  <MessageResponse>{getText(m)}</MessageResponse>
                ) : (
                  getText(m)
                )}
              </MessageContent>
            </Message>
          ))}
          {error && (
            <Message from="assistant">
              <MessageContent>
                <p className="text-destructive">{error.message}</p>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t border-border px-4 py-3">
        <PromptInput onSubmit={handleSubmit} multiple>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={e => setInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={status === 'submitted' || status === 'streaming' ? 'streaming' : 'ready'}
              onClick={status === 'submitted' || status === 'streaming' ? () => stop?.() : undefined}
            >
              {status === 'submitted' || status === 'streaming' ? <StopCircle /> : undefined}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
};

export default AIChatView;
