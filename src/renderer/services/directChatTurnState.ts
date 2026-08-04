import { ThinkingDurationTracker } from '../../common/thinkingDuration';
import type { CoworkMessage, CoworkMessageMetadata } from '../types/cowork';

export type DirectChatMessageResult = {
  message: CoworkMessage;
  isNew: boolean;
};

export type FinishedThinkingMessage = {
  message: CoworkMessage;
  messageWasAdded: boolean;
};

const stringifyToolOutput = (output: unknown): string => {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return String(output);
  }
};

const cloneMessage = (message: CoworkMessage): CoworkMessage => ({
  ...message,
  ...(message.metadata ? { metadata: { ...message.metadata } } : {}),
});

/** Keeps direct-chat messages in stream order while coalescing token updates in the view. */
export class DirectChatTurnState {
  private readonly messages: CoworkMessage[] = [];
  private readonly thinkingIdPrefix: string;
  private thinkingSequence = 0;
  private activeThinking: {
    message: CoworkMessage;
    tracker: ThinkingDurationTracker;
    messageWasAdded: boolean;
  } | null = null;
  private assistantMessage: CoworkMessage | null = null;

  constructor(
    private readonly assistantId: string,
    initialThinkingId: string,
    private readonly createId?: () => string,
  ) {
    this.thinkingIdPrefix = initialThinkingId;
  }

  get messagesSnapshot(): CoworkMessage[] {
    return this.messages.map(cloneMessage);
  }

  get isThinkingActive(): boolean {
    return this.activeThinking !== null;
  }

  startReasoning(): DirectChatMessageResult {
    if (this.activeThinking) {
      return { message: cloneMessage(this.activeThinking.message), isNew: false };
    }
    const id =
      this.thinkingSequence === 0
        ? this.thinkingIdPrefix
        : (this.createId?.() ?? `${this.assistantId}-thinking-${this.thinkingSequence}`);
    this.thinkingSequence += 1;
    const message: CoworkMessage = {
      id,
      type: 'assistant',
      content: '',
      timestamp: Date.now(),
      metadata: { isStreaming: true, isFinal: false, isThinking: true },
    };
    this.messages.push(message);
    this.activeThinking = {
      message,
      tracker: new ThinkingDurationTracker(),
      messageWasAdded: false,
    };
    return { message: cloneMessage(message), isNew: true };
  }

  appendReasoning(delta: string): DirectChatMessageResult {
    const result = this.startReasoning();
    const message = this.activeThinking!.message;
    message.content += delta;
    message.metadata = {
      ...message.metadata,
      isStreaming: true,
      isFinal: false,
      isThinking: true,
    };
    this.activeThinking?.tracker.start();
    return { message: cloneMessage(message), isNew: result.isNew };
  }

  markReasoningMessageAdded(): void {
    if (this.activeThinking) this.activeThinking.messageWasAdded = true;
  }

  finishReasoning(): FinishedThinkingMessage | null {
    const activeThinking = this.activeThinking;
    if (!activeThinking) return null;
    const thinkingDurationMs = activeThinking.tracker.finish();
    activeThinking.message.metadata = {
      ...activeThinking.message.metadata,
      isStreaming: false,
      isFinal: true,
      isThinking: true,
      ...(thinkingDurationMs !== undefined && { thinkingDurationMs }),
    };
    this.activeThinking = null;
    return {
      message: cloneMessage(activeThinking.message),
      messageWasAdded: activeThinking.messageWasAdded,
    };
  }

  startAssistant(): DirectChatMessageResult {
    if (this.assistantMessage) {
      return { message: cloneMessage(this.assistantMessage), isNew: false };
    }
    const message: CoworkMessage = {
      id: this.assistantId,
      type: 'assistant',
      content: '',
      timestamp: Date.now(),
      metadata: { isStreaming: true, isFinal: false },
    };
    this.messages.push(message);
    this.assistantMessage = message;
    return { message: cloneMessage(message), isNew: true };
  }

  appendAssistant(delta: string): DirectChatMessageResult {
    const result = this.startAssistant();
    this.assistantMessage!.content += delta;
    return { message: cloneMessage(this.assistantMessage!), isNew: result.isNew };
  }

  updateAssistantMetadata(metadata: CoworkMessageMetadata): void {
    if (!this.assistantMessage) return;
    this.assistantMessage.metadata = {
      ...this.assistantMessage.metadata,
      ...metadata,
    };
  }

  addToolUse(toolCallId: string, input: Record<string, unknown>): CoworkMessage {
    const message: CoworkMessage = {
      id: toolCallId,
      type: 'tool_use',
      content: '',
      timestamp: Date.now(),
      metadata: {
        toolName: 'web_search',
        toolInput: input,
        toolUseId: toolCallId,
      },
    };
    this.messages.push(message);
    return cloneMessage(message);
  }

  addToolResult(toolCallId: string, output: unknown, error?: string): CoworkMessage {
    const message: CoworkMessage = {
      id: `${toolCallId}-result`,
      type: 'tool_result',
      content: error ?? stringifyToolOutput(output),
      timestamp: Date.now(),
      metadata: {
        toolName: 'web_search',
        toolUseId: toolCallId,
        toolResult: error ?? stringifyToolOutput(output),
        ...(error ? { error, isError: true } : {}),
      },
    };
    this.messages.push(message);
    return cloneMessage(message);
  }
}
