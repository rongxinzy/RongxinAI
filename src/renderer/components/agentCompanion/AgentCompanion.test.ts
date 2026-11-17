import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { AgentCompanionState, resolveAgentCompanionState } from './constants';

const source = readFileSync(
  fileURLToPath(new URL('./AgentCompanion.tsx', import.meta.url)),
  'utf8',
);

test('defines stable companion state constants', () => {
  expect(AgentCompanionState).toEqual({
    Thinking: 'thinking',
    Completed: 'completed',
    Idle: 'idle',
  });
});

test('resolves active, successful, and incomplete turn outcomes', () => {
  expect(
    resolveAgentCompanionState({
      isTurnComplete: false,
      hasAssistantAnswer: false,
      hasTerminalOutcome: false,
    }),
  ).toBe(AgentCompanionState.Thinking);
  expect(
    resolveAgentCompanionState({
      isTurnComplete: true,
      hasAssistantAnswer: true,
      hasTerminalOutcome: false,
    }),
  ).toBe(AgentCompanionState.Completed);
  expect(
    resolveAgentCompanionState({
      isTurnComplete: true,
      hasAssistantAnswer: true,
      hasTerminalOutcome: true,
    }),
  ).toBe(AgentCompanionState.Idle);
  expect(
    resolveAgentCompanionState({
      isTurnComplete: true,
      hasAssistantAnswer: false,
      hasTerminalOutcome: false,
    }),
  ).toBe(AgentCompanionState.Idle);
});

test('uses a compact orb that pauses outside the active state', () => {
  expect(source).toContain('variant={ThinkingIndicatorVariant.Companion}');
  expect(source).toContain('paused={!isThinking}');
});
