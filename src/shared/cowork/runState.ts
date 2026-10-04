export const CoworkRunPhase = {
  Waiting: 'waiting',
  Thinking: 'thinking',
  Writing: 'writing',
  Tool: 'tool',
  Retry: 'retry',
  Compacting: 'compacting',
  Approval: 'approval',
  Finishing: 'finishing',
  Completed: 'completed',
  Error: 'error',
  Stopped: 'stopped',
} as const;
export type CoworkRunPhase = (typeof CoworkRunPhase)[keyof typeof CoworkRunPhase];

export const CoworkRunPolicy = {
  PollMs: 5_000,
  UnconfirmedMs: 15_000,
  EmitMs: 200,
  PreviewCharacters: 2_000,
  ContentChunkCharacters: 60_000,
  MaximumContentCharacters: 2_000_000,
} as const;

export interface CoworkRunSnapshot {
  sessionId: string;
  runId: string;
  sequence: number;
  phase: CoworkRunPhase;
  running: boolean;
  startedAt: number;
  confirmedAt: number;
  lastProgressAt: number;
  toolName?: string;
  toolStartedAt?: number;
  preview?: string;
  retryAttempt?: number;
  retryAt?: number;
}

export interface CoworkContentPatch {
  sessionId: string;
  messageId: string;
  revision: number;
  baseRevision: number;
  offset: number;
  content: string;
  totalLength: number;
  complete: boolean;
  truncated: boolean;
  metadata?: Record<string, unknown>;
}

export const isTerminalRunPhase = (phase: CoworkRunPhase): boolean =>
  phase === CoworkRunPhase.Completed ||
  phase === CoworkRunPhase.Error ||
  phase === CoworkRunPhase.Stopped;

export const PiRunEvent = {
  AgentStart: 'agent_start',
  AgentEnd: 'agent_end',
  MessageStart: 'message_start',
  MessageUpdate: 'message_update',
  ToolStart: 'tool_execution_start',
  ToolUpdate: 'tool_execution_update',
  ToolEnd: 'tool_execution_end',
  RetryStart: 'auto_retry_start',
  RetryEnd: 'auto_retry_end',
  CompactStart: 'compaction_start',
  CompactEnd: 'compaction_end',
  ThinkingDelta: 'thinking_delta',
  TextDelta: 'text_delta',
  ToolCallStart: 'toolcall_start',
  ToolCallDelta: 'toolcall_delta',
} as const;
