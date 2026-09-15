import { expect, test, vi } from 'vitest';

import { resolveCodingExpertSelection } from './builtinCodingExpertSelection';

test('joins the selected expert prompts in order', () => {
  const resolveSnapshots = vi.fn(() => [
    { promptSnapshot: '  You are a staff engineer.  ' },
    { promptSnapshot: 'You review migrations.' },
  ]);

  expect(resolveCodingExpertSelection({ expertIds: ['a', 'b'], resolveSnapshots })).toEqual({
    expertIds: ['a', 'b'],
    systemPrompt: 'You are a staff engineer.\n\nYou review migrations.',
  });
  expect(resolveSnapshots).toHaveBeenCalledWith(['a', 'b']);
});

test('clears the prompt when the selection is cleared', () => {
  const resolveSnapshots = vi.fn(() => []);

  expect(resolveCodingExpertSelection({ expertIds: [], resolveSnapshots })).toEqual({
    expertIds: [],
    systemPrompt: '',
  });
  expect(resolveSnapshots).not.toHaveBeenCalled();
});

test('lets a stale expert fail the turn instead of running without it', () => {
  const resolveSnapshots = () => {
    throw new Error("Expert 'gone' is not installed");
  };

  expect(() => resolveCodingExpertSelection({ expertIds: ['gone'], resolveSnapshots })).toThrow(
    "Expert 'gone' is not installed",
  );
});
