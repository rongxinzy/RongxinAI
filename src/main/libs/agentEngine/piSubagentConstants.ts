export const PiSubagentProfileId = {
  Researcher: 'researcher',
  Scout: 'scout',
  Planner: 'planner',
  Reviewer: 'reviewer',
} as const;

export type PiSubagentProfileId = (typeof PiSubagentProfileId)[keyof typeof PiSubagentProfileId];

export const PiSubagentToolName = 'subagent';

export const PiSubagentTerminationReason = {
  Settled: 'settled',
  Error: 'error',
} as const;
export type PiSubagentTerminationReason =
  (typeof PiSubagentTerminationReason)[keyof typeof PiSubagentTerminationReason];

export interface PiSubagentExecutionMetadata {
  terminationReason: PiSubagentTerminationReason;
  durationMs: number;
  assistantTurns: number;
  toolCalls: number;
}

export interface PiSubagentChildToolEvent {
  type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end';
  toolCallId: string;
  parentToolCallId?: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
}
