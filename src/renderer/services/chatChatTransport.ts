import {
  type ChatRequestOptions,
  type ChatTransport,
  generateId,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';

import { apiService } from './api';
import type { DirectChatRequestOptions } from './localThinkingRequest';

/** Extract text from a UIMessage's text parts. */
function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

/**
 * A `ChatTransport` that bridges the `apiService.chat()` call (direct LLM,
 * no agent engine) into the AI SDK v6 `useChat` hook.
 *
 * Much simpler than CoworkChatTransport — no tool use, no permissions,
 * just text + reasoning streaming.
 */
export class ChatChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly options: DirectChatRequestOptions = {}) {}

  getSessionId(): null {
    return null;
  }

  // -- ChatTransport impl --------------------------------------------

  async sendMessages({
    messages,
    abortSignal,
  }: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    const directChatOptions = this.options;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const prompt = lastUser ? extractText(lastUser) : '';
    if (!prompt.trim()) throw new Error('No prompt to send.');

    // Build history from previous messages (filtering out the current user message)
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of messages) {
      if (msg.id === lastUser?.id) break; // Don't include the current prompt in history
      if (msg.role === 'user' || msg.role === 'assistant') {
        history.push({ role: msg.role, content: extractText(msg) });
      }
    }

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let closed = false;
        let textId: string | null = null;
        let reasoningId: string | null = null;
        let lastContent = '';
        let lastReasoning = '';

        const enqueue = (chunk: UIMessageChunk) => {
          if (!closed) controller.enqueue(chunk);
        };

        const close = (error?: string) => {
          if (closed) return;
          closed = true;
          if (textId) enqueue({ type: 'text-end', id: textId });
          if (reasoningId) enqueue({ type: 'reasoning-end', id: reasoningId });
          enqueue({
            type: 'finish',
            finishReason: error ? ('error' as const) : ('stop' as const),
          });
          controller.close();
        };

        void apiService
          .chat(
            prompt,
            (content, reasoning) => {
              if (abortSignal?.aborted) {
                close('aborted');
                return;
              }
              // apiService sends accumulated full content — diff to get deltas
              if (reasoning) {
                const delta = reasoning.startsWith(lastReasoning)
                  ? reasoning.slice(lastReasoning.length)
                  : reasoning;
                lastReasoning = reasoning;
                if (delta) {
                  if (!reasoningId) {
                    reasoningId = generateId();
                    enqueue({ type: 'reasoning-start', id: reasoningId });
                  }
                  enqueue({ type: 'reasoning-delta', id: reasoningId, delta });
                }
              }
              if (content) {
                const delta = content.startsWith(lastContent)
                  ? content.slice(lastContent.length)
                  : content;
                lastContent = content;
                if (delta) {
                  if (!textId) {
                    textId = generateId();
                    enqueue({ type: 'text-start', id: textId });
                  }
                  enqueue({ type: 'text-delta', id: textId, delta });
                }
              }
            },
            history,
            directChatOptions,
          )
          .then(() => {
            close();
          })
          .catch((error: Error) => {
            enqueue({ type: 'error', errorText: error.message || 'Chat API error' });
            close('error');
          });

        abortSignal?.addEventListener('abort', () => {
          close('aborted');
        });
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
