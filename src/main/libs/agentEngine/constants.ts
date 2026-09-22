export const AgentLifecyclePhase = {
  Start: 'start',
  End: 'end',
  Error: 'error',
  Fallback: 'fallback',
} as const;
export type AgentLifecyclePhase = (typeof AgentLifecyclePhase)[keyof typeof AgentLifecyclePhase];

export const PiToolEventType = {
  ExecutionEnd: 'tool_execution_end',
} as const;
