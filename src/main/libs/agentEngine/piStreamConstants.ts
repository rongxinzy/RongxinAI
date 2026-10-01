export const PiAssistantEventType = {
  Start: 'start',
  TextStart: 'text_start',
  TextDelta: 'text_delta',
  TextEnd: 'text_end',
  ThinkingStart: 'thinking_start',
  ThinkingDelta: 'thinking_delta',
  ThinkingEnd: 'thinking_end',
} as const;

export const PiStreamSegmentKind = {
  Text: 'text',
  Thinking: 'thinking',
} as const;

export type PiStreamSegmentKind = (typeof PiStreamSegmentKind)[keyof typeof PiStreamSegmentKind];

/** Top-level Pi agent session event types that drive stream-liveness tracking. */
export const PiAgentEventType = {
  AgentStart: 'agent_start',
  AgentEnd: 'agent_end',
  AgentSettled: 'agent_settled',
  TurnStart: 'turn_start',
  MessageStart: 'message_start',
  MessageUpdate: 'message_update',
  MessageEnd: 'message_end',
  ToolExecutionStart: 'tool_execution_start',
  ToolExecutionEnd: 'tool_execution_end',
  AutoRetryStart: 'auto_retry_start',
} as const;

export type PiAgentEventType = (typeof PiAgentEventType)[keyof typeof PiAgentEventType];
