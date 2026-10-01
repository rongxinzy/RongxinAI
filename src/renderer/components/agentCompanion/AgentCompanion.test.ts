import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { AgentCompanionState, resolveAgentCompanionState } from './constants';

const source = readFileSync(fileURLToPath(new URL('./AgentCompanion.tsx', import.meta.url)), 'utf8');

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

test('keeps active motion transform-only and respects reduced motion', () => {
  expect(source).toContain('useReducedMotion()');
  expect(source).toContain('repeat: Number.POSITIVE_INFINITY');
  expect(source).toContain('rotate: [-3, 2, -3]');
  expect(source).toContain('scaleY: [1, 1.06, 1]');
  expect(source).toContain('y: [1, -4, 1]');
  expect(source).not.toMatch(/animate=\{[^}]*?(width|height|top|left):/s);
});

test('crossfades between dedicated thinking and completed assets', () => {
  expect(source).toContain('zhiyuan-scholar-thinking.png');
  expect(source).toContain('zhiyuan-scholar-completed.png');
  expect(source).toContain('animate={isCompleted ? completedAnimation : hiddenCompletedAnimation}');
});

test('uses the same compact size for both companion states', () => {
  expect(source).toContain("'relative block size-9 shrink-0'");
  expect(source).not.toContain('size-10');
  expect(source).not.toContain('size-12');
});

test('normalizes the visual mass of the two source silhouettes', () => {
  expect(source).toContain('const thinkingVisualScale = 0.95');
  expect(source).toContain('const completedVisualScale = 1.05');
});
