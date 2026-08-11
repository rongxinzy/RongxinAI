export const ConversationHistoryRole = {
  User: 'user',
  Assistant: 'assistant',
} as const;

export type ConversationHistoryRole =
  (typeof ConversationHistoryRole)[keyof typeof ConversationHistoryRole];

export const CONVERSATION_HISTORY_TOOL_NAME = 'conversation_history';

export const ConversationHistoryExcludedMessageType = {
  ToolResult: 'tool_result',
} as const;
