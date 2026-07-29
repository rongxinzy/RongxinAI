import {
  PiAssistantStopReason,
  PiContentBlockType,
  PiWriteTokenLimitRecovery,
  type PiWriteRecoveryMessage,
} from './piWriteTokenLimit';

export const PiSubagentEventType = {
  AgentEnd: 'agent_end',
  AgentSettled: 'agent_settled',
  Error: 'error',
  MessageEnd: 'message_end',
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
  timeoutMs: number;
};

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
): Promise<string> =>
  new Promise((resolve, reject) => {
    const recovery = new PiWriteTokenLimitRecovery(options.maxOutputTokens);
    let latestAnswer = '';
    let settled = false;
    let unsubscribe = (): void => {};

    const finish = (output: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve(output);
    };

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      reject(error);
    };

    const timeout = setTimeout(
      () => finish(`(subagent timed out after ${Math.round(options.timeoutMs / 1000)}s)`),
      options.timeoutMs,
    );

    try {
      const subscribedUnsubscribe = session.subscribe(event => {
        const message = event.message;
        if (
          event.type === PiSubagentEventType.MessageEnd &&
          message?.role === PiMessageRole.Assistant
        ) {
          recovery.queueIfNeeded(message, session);
          if (message.stopReason === PiAssistantStopReason.Error) {
            finish(`Error: ${message.errorMessage || 'Subagent encountered an error'}`);
            return;
          }

          const answer = extractAssistantText(message);
          if (answer) latestAnswer = answer;
        }

        if (event.type === PiSubagentEventType.Error) {
          finish(`Error: ${message?.errorMessage || 'Subagent encountered an error'}`);
        } else if (event.type === PiSubagentEventType.AgentSettled) {
          finish(latestAnswer || '(no output)');
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
