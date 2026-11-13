export const PiExtensionEventType = {
  ToolCall: 'tool_call',
  ToolResult: 'tool_result',
  BeforeAgentStart: 'before_agent_start',
} as const;

interface PiToolCallEvent {
  toolCallId: string;
  toolName: string;
  input?: unknown;
}

interface PiToolResultEvent {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  isError: boolean;
  content?: unknown;
  details?: unknown;
}

interface PiBeforeAgentStartEvent {
  type: 'before_agent_start';
  messageType?: 'user' | 'custom';
  prompt?: string;
  systemPromptOptions: {
    sections: Record<string, string>;
  };
}

interface PiToolCallEventResult {
  block: true;
  reason: string;
}

export interface PiExtensionApi {
  on(
    event: typeof PiExtensionEventType.ToolCall,
    handler: (
      event: PiToolCallEvent,
    ) => PiToolCallEventResult | undefined | Promise<PiToolCallEventResult | undefined>,
  ): void;
  on(
    event: typeof PiExtensionEventType.ToolResult,
    handler: (event: PiToolResultEvent) => void | Promise<void>,
  ): void;
  on(
    event: typeof PiExtensionEventType.BeforeAgentStart,
    handler: (event: PiBeforeAgentStartEvent) => void | Promise<void>,
  ): void;
}

export type PiExtensionFactory = (extensionApi: PiExtensionApi) => void;
