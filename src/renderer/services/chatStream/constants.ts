export const ChatStreamEvent = {
  Finish: 'finish',
  Error: 'error',
  Abort: 'abort',
  MessageStop: 'message_stop',
  MessageDelta: 'message_delta',
  ResponseCompleted: 'response.completed',
  ResponseIncomplete: 'response.incomplete',
} as const;
export const ChatFinishReason = {
  Stop: 'stop',
  Length: 'length',
  Tools: 'tool-calls',
  Filter: 'content-filter',
  Other: 'other',
} as const;
export const ProviderFinishReason = {
  Length: 'length',
  MaxTokens: 'max_tokens',
  GeminiMaxTokens: 'MAX_TOKENS',
  Tools: 'tool_calls',
  Function: 'function_call',
  Filter: 'content_filter',
} as const;
export const ChatStreamPolicy = { MaximumBufferedCharacters: 1_048_576 } as const;
