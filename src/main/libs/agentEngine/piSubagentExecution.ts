import {
  PiAssistantStopReason,
  PiContentBlockType,
  PiWriteTokenLimitRecovery,
  type PiWriteRecoveryMessage,
} from './piWriteTokenLimit';
import {
  PiSubagentTerminationReason,
  type PiSubagentTerminationReason as PiSubagentTerminationReasonValue,
} from './piSubagentConstants';

export const PiSubagentEventType = {
  AgentEnd: 'agent_end',
  AgentSettled: 'agent_settled',
  Error: 'error',
  MessageEnd: 'message_end',
  ToolExecutionStart: 'tool_execution_start',
} as const;

export const PiMessageRole = {
  Assistant: 'assistant',
} as const;

type PiSubagentMessage = PiWriteRecoveryMessage & {
  role: string;
  errorMessage?: string;
};

type PiSubagentEvent = {
  type: string;
  message?: PiSubagentMessage;
};

export type PiSubagentSession = {
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  subscribe(listener: (event: PiSubagentEvent) => void): () => void;
};

export type RunPiSubagentOptions = {
  maxOutputTokens: number;
  hardTimeoutMs: number;
  softTimeoutMs?: number;
  maxAssistantTurns?: number;
  maxToolCalls?: number;
  steerPrompt?: string;
};

export interface PiSubagentExecutionMetadata {
  terminationReason: PiSubagentTerminationReasonValue;
  durationMs: number;
  assistantTurns: number;
  toolCalls: number;
  steerRequested: boolean;
}

export interface PiSubagentExecutionResult extends PiSubagentExecutionMetadata {
  output: string;
}

const extractAssistantText = (message: PiSubagentMessage): string => {
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .filter(block => block.type === PiContentBlockType.Text && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim();
};

export const runPiSubagent = (
  session: PiSubagentSession,
  task: string,
  options: RunPiSubagentOptions,
): Promise<PiSubagentExecutionResult> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const recovery = new PiWriteTokenLimitRecovery(options.maxOutputTokens);
    let latestAnswer = '';
    let settled = false;
    let assistantTurns = 0;
    let toolCalls = 0;
    let steerRequested = false;
    let unsubscribe = (): void => {};
    let softTimeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (output: string, terminationReason: PiSubagentTerminationReasonValue): void => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (softTimeout) clearTimeout(softTimeout);
      unsubscribe();
      resolve({
        output,
        terminationReason,
        durationMs: Math.max(0, Date.now() - startedAt),
        assistantTurns,
        toolCalls,
        steerRequested,
      });
    };

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (softTimeout) clearTimeout(softTimeout);
      unsubscribe();
      reject(error);
    };

    const requestSteer = (): void => {
      if (settled || steerRequested || !options.steerPrompt) return;
      steerRequested = true;
      try {
        void session.steer(options.steerPrompt).catch(error => {
          console.warn('[PiSubagent] failed to request a bounded final response:', error);
        });
      } catch (error) {
        console.warn('[PiSubagent] failed to request a bounded final response:', error);
      }
    };

    const hardTimeout = setTimeout(
      () =>
        finish(
          `(subagent hard timeout after ${Math.round(options.hardTimeoutMs / 1000)}s)`,
          PiSubagentTerminationReason.HardTimeout,
        ),
      options.hardTimeoutMs,
    );
    if (options.softTimeoutMs !== undefined) {
      softTimeout = setTimeout(requestSteer, options.softTimeoutMs);
    }

    try {
      const subscribedUnsubscribe = session.subscribe(event => {
        const message = event.message;
        if (
          event.type === PiSubagentEventType.MessageEnd &&
          message?.role === PiMessageRole.Assistant
        ) {
          assistantTurns += 1;
          recovery.queueIfNeeded(message, session);
          if (message.stopReason === PiAssistantStopReason.Error) {
            finish(
              `Error: ${message.errorMessage || 'Subagent encountered an error'}`,
              PiSubagentTerminationReason.Error,
            );
            return;
          }

          const answer = extractAssistantText(message);
          if (answer) latestAnswer = answer;
          if (
            options.maxAssistantTurns !== undefined &&
            assistantTurns >= options.maxAssistantTurns
          ) {
            requestSteer();
          }
        }

        if (event.type === PiSubagentEventType.Error) {
          finish(
            `Error: ${message?.errorMessage || 'Subagent encountered an error'}`,
            PiSubagentTerminationReason.Error,
          );
        } else if (event.type === PiSubagentEventType.ToolExecutionStart) {
          toolCalls += 1;
          if (options.maxToolCalls !== undefined && toolCalls >= options.maxToolCalls) {
            requestSteer();
          }
        } else if (event.type === PiSubagentEventType.AgentSettled) {
          finish(latestAnswer || '(no output)', PiSubagentTerminationReason.Settled);
        }
      });
      unsubscribe = subscribedUnsubscribe;
      if (settled) subscribedUnsubscribe();
    } catch (error) {
      fail(error);
      return;
    }

    if (settled) return;

    try {
      void session.prompt(task).catch(error => fail(error));
    } catch (error) {
      fail(error);
    }
  });

const isFiniteNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const extractPiSubagentExecutionMetadata = (
  result: unknown,
): PiSubagentExecutionMetadata | undefined => {
  if (!result || typeof result !== 'object') return undefined;
  const details = (result as Record<string, unknown>).details;
  if (!details || typeof details !== 'object') return undefined;
  const execution = (details as Record<string, unknown>).execution;
  if (!execution || typeof execution !== 'object') return undefined;
  const raw = execution as Record<string, unknown>;
  if (
    !Object.values(PiSubagentTerminationReason).includes(
      raw.terminationReason as PiSubagentTerminationReasonValue,
    ) ||
    !isFiniteNonNegativeNumber(raw.durationMs) ||
    !isFiniteNonNegativeNumber(raw.assistantTurns) ||
    !isFiniteNonNegativeNumber(raw.toolCalls) ||
    typeof raw.steerRequested !== 'boolean'
  ) {
    return undefined;
  }
  return {
    terminationReason: raw.terminationReason as PiSubagentTerminationReasonValue,
    durationMs: raw.durationMs,
    assistantTurns: raw.assistantTurns,
    toolCalls: raw.toolCalls,
    steerRequested: raw.steerRequested,
  };
};
