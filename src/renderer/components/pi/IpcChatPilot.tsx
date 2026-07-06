import { Conversation, ConversationContent } from '@shared/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Send, StopCircle } from 'lucide-react';
import React, { useState } from 'react';

import { type UIMessage,useIpcChat } from '../../hooks/useIpcChat';

/**
 * AI SDK v6 + ai-elements pilot chat component.
 *
 * Uses ai-elements `Conversation` / `Message` for the message list and
 * `PromptInput` for the input area, all driven by `useIpcChat`.
 *
 * This component proves the full stack:
 *   IPC transport → ai-sdk useChat → ai-elements UI
 *
 * It is not wired into the main Cowork or LocalInference flows.
 */
export const IpcChatPilot: React.FC = () => {
  const { messages, sendMessage, status, stop, error } = useIpcChat({ provider: 'openai' });
  const [input, setInput] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || status !== 'ready') return;
    void sendMessage({ text: input.trim() });
    setInput('');
  };

  const getMessageText = (message: UIMessage): string =>
    message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('');

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="px-4 py-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Send a message to test the AI SDK + ai-elements stack.
              </p>
            </div>
          )}
          {messages.map((message: UIMessage) => (
            <Message
              key={message.id}
              from={message.role === 'user' ? 'user' : 'assistant'}
            >
              <MessageContent>
                {message.role === 'assistant' ? (
                  <MessageResponse>{getMessageText(message)}</MessageResponse>
                ) : (
                  getMessageText(message)
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
      </Conversation>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={status === 'submitted' || status === 'streaming'}
          className="flex-1"
        />
        {status === 'submitted' || status === 'streaming' ? (
          <Button type="button" variant="secondary" size="icon" onClick={() => void stop()}>
            <StopCircle className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </div>
  );
};

export default IpcChatPilot;
