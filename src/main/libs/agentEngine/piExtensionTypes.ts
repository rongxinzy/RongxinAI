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

export interface PiBeforeAgentStartSystemPromptOptions {
  customPrompt?: string;
  forceSystemPrompt?: string;
  selectedTools?: string[];
  hiddenTools?: string[];
  toolSnippets?: Record<string, string>;
  toolGuidelines?: Record<string, string[]>;
  promptGuidelines?: string[];
  appendSystemPrompt?: string;
  sections: Record<string, string>;
  cwd?: string;
  contextFiles?: Array<{ path: string; content: string }>;
  skills?: unknown[];
}

interface PiBeforeAgentStartEvent {
  type: 'before_agent_start';
  messageType?: 'user' | 'custom';
  prompt?: string;
  systemPromptOptions: PiBeforeAgentStartSystemPromptOptions;
}

interface PiBeforeAgentStartCustomMessage {
  customType: string;
  content: string;
  display: boolean;
}

interface PiBeforeAgentStartResult {
  message?: PiBeforeAgentStartCustomMessage;
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
    handler: (
      event: PiBeforeAgentStartEvent,
    ) => PiBeforeAgentStartResult | void | Promise<PiBeforeAgentStartResult | void>,
  ): void;
}

export type PiExtensionFactory = (extensionApi: PiExtensionApi) => void;
