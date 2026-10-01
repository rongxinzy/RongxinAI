export const AgentCompanionState = {
  Thinking: 'thinking',
  Completed: 'completed',
  Idle: 'idle',
} as const;

export type AgentCompanionState =
  (typeof AgentCompanionState)[keyof typeof AgentCompanionState];

interface ResolveAgentCompanionStateOptions {
  isTurnComplete: boolean;
  hasAssistantAnswer: boolean;
  hasTerminalOutcome: boolean;
}

export const resolveAgentCompanionState = ({
  isTurnComplete,
  hasAssistantAnswer,
  hasTerminalOutcome,
}: ResolveAgentCompanionStateOptions): AgentCompanionState => {
  if (!isTurnComplete) return AgentCompanionState.Thinking;
  if (hasAssistantAnswer && !hasTerminalOutcome) return AgentCompanionState.Completed;
  return AgentCompanionState.Idle;
};
