export const PiExtensionEventType = {
  ToolCall: 'tool_call',
  ToolResult: 'tool_result',
} as const;

export interface PiToolCallEvent {
  toolCallId: string;
  toolName: string;
  input?: unknown;
}

export interface PiToolResultEvent {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  isError: boolean;
}

export interface PiToolCallEventResult {
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
}

export type PiExtensionFactory = (extensionApi: PiExtensionApi) => void;
