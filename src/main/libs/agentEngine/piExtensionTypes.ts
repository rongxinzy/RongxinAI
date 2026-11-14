export const PiExtensionEventType = {
  ToolCall: 'tool_call',
  ToolResult: 'tool_result',
  BeforeAgentStart: 'before_agent_start',
  BeforeProviderRequest: 'before_provider_request',
  BeforeProviderHeaders: 'before_provider_headers',
  AfterProviderResponse: 'after_provider_response',
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

export interface BeforeProviderHeadersEvent {
  type: 'before_provider_headers';
  headers: Record<string, string | null>;
}

export interface BeforeProviderRequestEvent {
  type: 'before_provider_request';
  payload: unknown;
}

export interface AfterProviderResponseEvent {
  type: 'after_provider_response';
  status: number;
  headers: Record<string, string>;
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
  on(
    event: typeof PiExtensionEventType.BeforeProviderHeaders | 'before_provider_headers',
    handler: (event: BeforeProviderHeadersEvent, ctx?: unknown) => void | Promise<void>,
  ): void;
  on(
    event: typeof PiExtensionEventType.BeforeProviderRequest | 'before_provider_request',
    handler: (
      event: BeforeProviderRequestEvent,
      ctx?: unknown,
    ) => unknown | void | Promise<unknown | void>,
  ): void;
  on(
    event: typeof PiExtensionEventType.AfterProviderResponse | 'after_provider_response',
    handler: (event: AfterProviderResponseEvent, ctx?: unknown) => void | Promise<void>,
  ): void;
}

export type PiExtensionFactory = (extensionApi: PiExtensionApi) => void;
