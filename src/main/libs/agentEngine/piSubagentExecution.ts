import {
  PiAssistantStopReason,
  PiContentBlockType,
  type PiWriteRecoveryMessage,
} from './piToolConstants';
import { PiSubagentTerminationReason } from './piSubagentConstants';

export const PiSubagentEventType = {
  AgentEnd: 'agent_end',
  AgentSettled: 'agent_settled',
  Error: 'error',
  MessageEnd: 'message_end',
  ToolExecutionStart: 'tool_execution_start',
  ToolExecutionUpdate: 'tool_execution_update',
  ToolExecutionEnd: 'tool_execution_end',
} as const;
export const PiMessageRole = { Assistant: 'assistant' } as const;

export type PiSubagentChildToolEvent = {
  type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end';
  toolCallId: string;
  parentToolCallId?: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
};

type PiSubagentMessage = PiWriteRecoveryMessage & { role: string; errorMessage?: string };
type PiSubagentEvent = {
  type: string;
  message?: PiSubagentMessage;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
};

export interface PiSubagentSession {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: PiSubagentEvent) => void): () => void;
}
export interface PiSubagentExecutionMetadata {
  terminationReason: (typeof PiSubagentTerminationReason)[keyof typeof PiSubagentTerminationReason];
  durationMs: number;
  assistantTurns: number;
  toolCalls: number;
}
export interface PiSubagentExecutionResult extends PiSubagentExecutionMetadata {
  output: string;
}

export interface RunPiSubagentOptions {
  signal?: AbortSignal;
  parentToolCallId?: string;
  onChildToolEvent?: (event: PiSubagentChildToolEvent) => void;
}

/** Pi owns retries, compaction and tool turns. The parent owns cancellation. */
export function runPiSubagent(
  session: PiSubagentSession,
  task: string,
  options: RunPiSubagentOptions = {},
): Promise<PiSubagentExecutionResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let latestAnswer = '';
    let pendingError: string | undefined;
    let settled = false;
    let assistantTurns = 0;
    let toolCalls = 0;
    let unsubscribe = (): void => {};
    const cleanup = (): void => {
      unsubscribe();
      options.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = (
      output: string,
      terminationReason: PiSubagentExecutionMetadata['terminationReason'],
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        output,
        terminationReason,
        durationMs: Math.max(0, Date.now() - startedAt),
        assistantTurns,
        toolCalls,
      });
    };
    const onAbort = (): void => fail(options.signal?.reason ?? new Error('Subagent cancelled.'));
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const subscribed = session.subscribe(event => {
        if (settled) return;
        const message = event.message;
        if (
          event.type === PiSubagentEventType.MessageEnd &&
          message?.role === PiMessageRole.Assistant
        ) {
          assistantTurns += 1;
          if (message.stopReason === PiAssistantStopReason.Error) {
            pendingError = message.errorMessage || 'Subagent encountered an error';
            return;
          }
          pendingError = undefined;
          const text =
            typeof message.content === 'string'
              ? message.content.trim()
              : message.content
                  .filter(
                    block =>
                      block.type === PiContentBlockType.Text && typeof block.text === 'string',
                  )
                  .map(block => block.text)
                  .join('\n')
                  .trim();
          if (text) latestAnswer = text;
        }
        if (
          event.type === PiSubagentEventType.ToolExecutionStart ||
          event.type === PiSubagentEventType.ToolExecutionUpdate ||
          event.type === PiSubagentEventType.ToolExecutionEnd
        ) {
          if (event.type === PiSubagentEventType.ToolExecutionStart) toolCalls += 1;
          if (options.onChildToolEvent && event.toolCallId && event.toolName) {
            options.onChildToolEvent({
              type: event.type,
              toolCallId: event.toolCallId,
              parentToolCallId: options.parentToolCallId,
              toolName: event.toolName,
              args: event.args,
              result: event.result,
              partialResult: event.partialResult,
              isError: event.isError,
            });
          }
        }
        if (event.type === PiSubagentEventType.Error) {
          finish(
            `Error: ${message?.errorMessage || 'Subagent encountered an error'}`,
            PiSubagentTerminationReason.Error,
          );
        } else if (event.type === PiSubagentEventType.AgentSettled) {
          finish(
            pendingError ? `Error: ${pendingError}` : latestAnswer || '(no output)',
            pendingError ? PiSubagentTerminationReason.Error : PiSubagentTerminationReason.Settled,
          );
        }
      });
      unsubscribe = subscribed;
      if (settled) {
        subscribed();
        return;
      }
      options.signal?.throwIfAborted();
      void session.prompt(task).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}
