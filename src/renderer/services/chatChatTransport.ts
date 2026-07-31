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
 * A `ChatTransport` for direct LLM chat with provider-native web-search tool
 * calling. Search execution remains in Electron's main process.
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
    const requestId = generateId();

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let closed = false;
        let textId: string | null = null;
        let reasoningId: string | null = null;
        let reasoningClosed = false;
        let lastContent = '';
        let lastReasoning = '';

        const enqueue = (chunk: UIMessageChunk) => {
          if (!closed) controller.enqueue(chunk);
        };

        const close = (error?: string) => {
          if (closed) return;
          closed = true;
          // Enqueue the terminal chunks directly; helper enqueue() skips when
          // closed is true, which would suppress these required end markers.
          if (textId) controller.enqueue({ type: 'text-end', id: textId });
          if (reasoningId) controller.enqueue({ type: 'reasoning-end', id: reasoningId });
          controller.enqueue({
            type: 'finish',
            finishReason: error ? ('error' as const) : ('stop' as const),
          });
          controller.close();
        };

        const emitReasoningEnd = () => {
          if (reasoningId) {
            enqueue({ type: 'reasoning-end', id: reasoningId });
            reasoningId = null;
            reasoningClosed = true;
          }
        };

        const emitTextEnd = () => {
          if (textId) {
            enqueue({ type: 'text-end', id: textId });
            textId = null;
            lastContent = '';
          }
        };

        if (abortSignal?.aborted) {
          close('aborted');
          return;
        }

        void apiService
          .chatWithWebSearch(
            prompt,
            (content, reasoning) => {
              if (abortSignal?.aborted) {
                close('aborted');
                return;
              }

              const fullContent = content ?? '';
              const fullReasoning = reasoning ?? '';

              // Compute deltas independently so a reasoning-to-answer transition
              // (where fullReasoning is non-empty but no longer growing) still
              // emits the new answer text. Prior code gated content emission on
              // `!reasoning`, which suppressed the answer after any reasoning.
              const reasoningDelta = fullReasoning.startsWith(lastReasoning)
                ? fullReasoning.slice(lastReasoning.length)
                : fullReasoning;
              const contentDelta = fullContent.startsWith(lastContent)
                ? fullContent.slice(lastContent.length)
                : fullContent;

              if (reasoningDelta && !reasoningClosed) {
                // Once answer text starts, close the reasoning block first.
                if (contentDelta && !textId) {
                  emitReasoningEnd();
                }
                if (!reasoningId) {
                  reasoningId = generateId();
                  enqueue({ type: 'reasoning-start', id: reasoningId });
                }
                enqueue({ type: 'reasoning-delta', id: reasoningId, delta: reasoningDelta });
                lastReasoning = fullReasoning;
              } else if (fullReasoning.length < lastReasoning.length && !reasoningClosed) {
                // Guard against non-monotonic resets.
                emitReasoningEnd();
              }

              if (contentDelta) {
                if (!textId) {
                  emitReasoningEnd();
                  textId = generateId();
                  enqueue({ type: 'text-start', id: textId });
                }
                enqueue({ type: 'text-delta', id: textId, delta: contentDelta });
                lastContent = fullContent;
              } else if (fullContent.length < lastContent.length) {
                emitTextEnd();
              }
            },
            history,
            directChatOptions,
            requestId,
            abortSignal,
          )
          .then(result => {
            const contextWindowTokens = directChatOptions.contextWindowTokens;
            if (result.usage && contextWindowTokens && contextWindowTokens > 0) {
              const cacheReadTokens = result.usage.cacheReadTokens ?? 0;
              const cacheWriteTokens = result.usage.cacheWriteTokens ?? 0;
              enqueue({
                type: 'data-context',
                data: {
                  contextWindowTokens,
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
                  ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
                  usedTokens:
                    result.usage.inputTokens +
                    cacheReadTokens +
                    cacheWriteTokens +
                    result.usage.outputTokens,
                },
              } as UIMessageChunk);
            }
            close();
          })
          .catch((error: Error) => {
            enqueue({ type: 'error', errorText: error.message || 'Chat API error' });
            close('error');
          });

        abortSignal?.addEventListener('abort', () => {
          apiService.cancelOngoingRequest(requestId);
          close('aborted');
        });
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
