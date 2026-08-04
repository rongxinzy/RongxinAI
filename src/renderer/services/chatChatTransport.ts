import {
  type ChatRequestOptions,
  type ChatTransport,
  generateId,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';

import { apiService } from './api';
import type { DirectChatRequestOptions } from './localThinkingRequest';
import {
  createToolInputAvailableChunk,
  createToolInputStartChunk,
  createToolOutputAvailableChunk,
  createToolOutputErrorChunk,
} from './toolChunkAdapter';
import { WebSearchToolEventType, type WebSearchToolEvent } from './webSearchToolEvents';

/** Extract text from a UIMessage's text parts. */
function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function logDirectChat(message: string): void {
  try {
    window.electron?.log?.fromRenderer?.('debug', 'DirectChat', message);
  } catch {
    // Logging is best-effort and must never affect the response stream.
  }
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
        let lastContent = '';
        let lastReasoning = '';

        const enqueue = (chunk: UIMessageChunk) => {
          if (!closed) controller.enqueue(chunk);
        };

        const close = (error?: string) => {
          if (closed) return;
          if (reasoningId) {
            enqueue({ type: 'reasoning-end', id: reasoningId });
            reasoningId = null;
          }
          if (textId) {
            enqueue({ type: 'text-end', id: textId });
            textId = null;
          }
          closed = true;
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
          }
        };

        const emitTextEnd = () => {
          if (textId) {
            enqueue({ type: 'text-end', id: textId });
            textId = null;
            lastContent = '';
          }
        };

        const emitProgress = (content?: string, reasoning?: string) => {
          if (abortSignal?.aborted) {
            close('aborted');
            return;
          }

          const fullContent = content ?? '';
          const fullReasoning = reasoning ?? '';

          // Provider callbacks contain full text, so only forward the suffix
          // that has not already been emitted to the AI SDK stream.
          const reasoningDelta = fullReasoning.startsWith(lastReasoning)
            ? fullReasoning.slice(lastReasoning.length)
            : fullReasoning;
          const contentDelta = fullContent.startsWith(lastContent)
            ? fullContent.slice(lastContent.length)
            : fullContent;

          if (reasoningDelta) {
            if (contentDelta && !textId) {
              emitReasoningEnd();
            }
            if (!reasoningId) {
              reasoningId = generateId();
              enqueue({ type: 'reasoning-start', id: reasoningId });
            }
            enqueue({ type: 'reasoning-delta', id: reasoningId, delta: reasoningDelta });
            lastReasoning = fullReasoning;
          } else if (fullReasoning.length < lastReasoning.length) {
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
        };

        if (abortSignal?.aborted) {
          close('aborted');
          return;
        }

        logDirectChat(`request ${requestId} started`);
        void apiService
          .chatWithWebSearch(
            prompt,
            emitProgress,
            history,
            directChatOptions,
            requestId,
            abortSignal,
            (event: WebSearchToolEvent) => {
              if (abortSignal?.aborted || closed) return;
              if (event.type === WebSearchToolEventType.Start) {
                emitReasoningEnd();
                emitTextEnd();
                enqueue(createToolInputStartChunk(event.toolCallId, 'web_search'));
                enqueue(createToolInputAvailableChunk(event.toolCallId, 'web_search', event.input));
                lastContent = '';
                lastReasoning = '';
                return;
              }
              if (event.type === WebSearchToolEventType.Complete) {
                enqueue(createToolOutputAvailableChunk(event.toolCallId, event.output));
                return;
              }
              enqueue(createToolOutputErrorChunk(event.toolCallId, event.error));
            },
          )
          .then(result => {
            // Some compatible providers buffer the response and never invoke
            // the progress callback. Reconcile the final result so the UI does
            // not remain on an empty "thinking" state.
            emitProgress(result.content, result.reasoning);
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
            logDirectChat(`request ${requestId} completed`);
            close();
          })
          .catch((error: Error) => {
            logDirectChat(`request ${requestId} failed: ${error.message || 'unknown error'}`);
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
