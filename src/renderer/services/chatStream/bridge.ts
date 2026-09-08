import type { UIMessageChunk } from 'ai';
import { i18nService } from '../i18n';
import {
  ChatFinishReason,
  ChatStreamEvent,
  ChatStreamPolicy,
  ProviderFinishReason,
} from './constants';

export interface StreamBridge {
  start(requestId: string): Promise<{ ok: boolean; status: number; error?: string }>;
  cancel(requestId: string): Promise<unknown>;
  onData(requestId: string, callback: (chunk: string) => void): () => void;
  onDone(requestId: string, callback: () => void): () => void;
  onError(requestId: string, callback: (error: string | { message: string }) => void): () => void;
  onAbort(requestId: string, callback: () => void): () => void;
}
interface Parser {
  feed(value: unknown): UIMessageChunk[];
  flush(): UIMessageChunk[];
}
const t = (key: string) => i18nService.t(key);
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function finishReason(
  value: unknown,
): (typeof ChatFinishReason)[keyof typeof ChatFinishReason] | null {
  const body = record(value);
  const choice = Array.isArray(body.choices) ? record(body.choices[0]) : {};
  const candidate = Array.isArray(body.candidates) ? record(body.candidates[0]) : {};
  const reason = choice.finish_reason ?? record(body.delta).stop_reason ?? candidate.finishReason;
  if (
    reason === ProviderFinishReason.Length ||
    reason === ProviderFinishReason.MaxTokens ||
    reason === ProviderFinishReason.GeminiMaxTokens ||
    body.type === ChatStreamEvent.ResponseIncomplete
  )
    return ChatFinishReason.Length;
  if (reason === ProviderFinishReason.Tools || reason === ProviderFinishReason.Function)
    return ChatFinishReason.Tools;
  if (reason === ProviderFinishReason.Filter) return ChatFinishReason.Filter;
  if (
    reason ||
    body.type === ChatStreamEvent.MessageStop ||
    body.type === ChatStreamEvent.ResponseCompleted
  )
    return ChatFinishReason.Stop;
  return null;
}

export function streamOverBridge(
  requestId: string,
  signal: AbortSignal | undefined,
  bridge: StreamBridge,
  parser: Parser,
): ReadableStream<UIMessageChunk> {
  let cancelConsumer: () => void = () => undefined;
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      let closed = false;
      let started = false;
      let cancelled = false;
      let buffered = '';
      let terminal: ReturnType<typeof finishReason> = null;
      const cleanup: Array<() => void> = [];
      const cancelUpstream = () => {
        if (!started || cancelled) return;
        cancelled = true;
        void bridge
          .cancel(requestId)
          .catch(error => console.warn('[ChatStream] cancellation failed:', error));
      };
      const close = (consumerCancelled = false) => {
        if (closed) return;
        closed = true;
        cleanup.forEach(remove => remove());
        if (!consumerCancelled) controller.close();
      };
      const fail = (message: string) => {
        if (closed) return;
        controller.enqueue({ type: ChatStreamEvent.Error, errorText: message });
        close();
        cancelUpstream();
      };
      const finish = () => {
        if (closed) return;
        if (terminal !== ChatFinishReason.Length)
          for (const chunk of parser.flush()) controller.enqueue(chunk);
        if (terminal === ChatFinishReason.Length)
          controller.enqueue({
            type: ChatStreamEvent.Error,
            errorText: t('chatStreamLengthLimit'),
          });
        controller.enqueue({
          type: ChatStreamEvent.Finish,
          finishReason: terminal ?? ChatFinishReason.Stop,
        });
        close();
        cancelUpstream();
      };
      const consume = (chunk: string, flush = false) => {
        if (closed) return;
        buffered += chunk;
        if (buffered.length > ChatStreamPolicy.MaximumBufferedCharacters) {
          fail(t('chatStreamInterrupted'));
          return;
        }
        const lines = buffered.split('\n');
        buffered = flush ? '' : (lines.pop() ?? '');
        for (const line of lines) {
          if (closed) return;
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') {
            finish();
            return;
          }
          try {
            const value: unknown = JSON.parse(data);
            terminal = finishReason(value) ?? terminal;
            for (const event of parser.feed(value)) {
              controller.enqueue(event);
              if (event.type === ChatStreamEvent.Error) {
                close();
                cancelUpstream();
                return;
              }
            }
          } catch {
            fail(t('chatStreamInterrupted'));
          }
        }
      };
      const abort = () => {
        if (closed) return;
        controller.enqueue({ type: ChatStreamEvent.Abort, reason: 'user' });
        close();
        cancelUpstream();
      };
      cancelConsumer = () => {
        close(true);
        cancelUpstream();
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      cleanup.push(bridge.onData(requestId, chunk => consume(chunk)));
      cleanup.push(
        bridge.onDone(requestId, () => {
          consume('', true);
          if (!closed) {
            if (terminal) finish();
            else fail(t('chatStreamInterrupted'));
          }
        }),
      );
      cleanup.push(
        bridge.onError(requestId, error => fail(typeof error === 'string' ? error : error.message)),
      );
      cleanup.push(bridge.onAbort(requestId, abort));
      signal?.addEventListener('abort', abort, { once: true });
      cleanup.push(() => signal?.removeEventListener('abort', abort));
      started = true;
      void bridge
        .start(requestId)
        .then(response => {
          if (!closed && !response.ok) fail(response.error || t('operationFailed'));
        })
        .catch(error => fail(error instanceof Error ? error.message : t('operationFailed')));
    },
    cancel() {
      cancelConsumer();
    },
  });
}
