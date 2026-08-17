import { expect, test } from 'vitest';

import {
  ExpertProductionWorkflowHeading,
  buildExpertProductionPrompt,
  prependProductionWorkflowPrompt,
} from './piExpertProductionPrompt';

test('defines production as the sole outer controller and experts as domain methods', () => {
  const prompt = buildExpertProductionPrompt();

  expect(prompt).toContain('sole outer lifecycle and progress controller');
  expect(prompt).toContain('expert workflow only as the domain method');
  expect(prompt).toContain('map them into production plan items');
  expect(prompt).toContain('Do not create or maintain a separate Markdown checklist');
});

test('adds expert coordination only when an expert participates in an active production run', () => {
  expect(prependProductionWorkflowPrompt('User request', 'Production protocol', true)).toBe(
    ['Production protocol', buildExpertProductionPrompt(), 'User request'].join('\n\n'),
  );
  expect(prependProductionWorkflowPrompt('User request', 'Production protocol', false)).toBe(
    'Production protocol\n\nUser request',
  );
  expect(
    prependProductionWorkflowPrompt('User request', 'Production protocol', false),
  ).not.toContain(ExpertProductionWorkflowHeading);
});
