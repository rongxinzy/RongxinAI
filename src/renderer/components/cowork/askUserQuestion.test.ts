import { expect, test } from 'vitest';

import type { CoworkPermissionRequest } from '../../types/cowork';
import {
  buildAskUserQuestionAllowResult,
  CoworkPermissionBehavior,
  CoworkPermissionToolName,
  hasAskUserQuestions,
  parseAskUserQuestions,
} from './askUserQuestion';

const makePermission = (toolInput: Record<string, unknown>): CoworkPermissionRequest => ({
  sessionId: 'session-1',
  requestId: 'request-1',
  toolName: CoworkPermissionToolName.AskUserQuestion,
  toolInput,
});

test('parses valid AskUserQuestion options and ignores invalid entries', () => {
  const questions = parseAskUserQuestions(
    makePermission({
      questions: [
        {
          header: 'Framework',
          question: 'Choose a framework',
          options: [{ label: 'React', description: 'Component based' }, { label: 42 }],
          multiSelect: true,
        },
        { question: 'Invalid', options: [] },
      ],
    }),
  );

  expect(questions).toEqual([
    {
      header: 'Framework',
      question: 'Choose a framework',
      options: [{ label: 'React', description: 'Component based' }],
      multiSelect: true,
    },
  ]);
});

test('only enables inline rendering when the request has a valid question', () => {
  expect(hasAskUserQuestions(makePermission({ questions: [] }))).toBe(false);
  expect(
    hasAskUserQuestions(
      makePermission({ questions: [{ question: 'Continue?', options: [{ label: 'Yes' }] }] }),
    ),
  ).toBe(true);
});

test('keeps the original request input when building an answer response', () => {
  const permission = makePermission({ context: { source: 'agent' } });

  expect(buildAskUserQuestionAllowResult(permission, { 'Continue?': 'Yes' })).toEqual({
    behavior: CoworkPermissionBehavior.Allow,
    updatedInput: {
      context: { source: 'agent' },
      answers: { 'Continue?': 'Yes' },
    },
  });
});
