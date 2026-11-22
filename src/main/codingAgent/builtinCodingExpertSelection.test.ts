import { expect, test, vi } from 'vitest';

import { resolveCodingExpertSelection } from './builtinCodingExpertSelection';

test('joins the selected expert prompts in order', async () => {
  const resolveSnapshots = vi.fn(async () => [
    { promptSnapshot: '  You are a staff engineer.  ' },
    { promptSnapshot: 'You review migrations.' },
  ]);

  await expect(
    resolveCodingExpertSelection({ expertIds: ['a', 'b'], resolveSnapshots }),
  ).resolves.toEqual({
    expertIds: ['a', 'b'],
    systemPrompt: 'You are a staff engineer.\n\nYou review migrations.',
  });
  expect(resolveSnapshots).toHaveBeenCalledWith(['a', 'b']);
});

test('clears the prompt when the selection is cleared', async () => {
  const resolveSnapshots = vi.fn(async () => []);

  await expect(resolveCodingExpertSelection({ expertIds: [], resolveSnapshots })).resolves.toEqual({
    expertIds: [],
    systemPrompt: '',
  });
  expect(resolveSnapshots).not.toHaveBeenCalled();
});

test('lets a stale expert fail the turn instead of running without it', async () => {
  const resolveSnapshots = async () => {
    throw new Error("Expert 'gone' is not installed");
  };

  await expect(
    resolveCodingExpertSelection({ expertIds: ['gone'], resolveSnapshots }),
  ).rejects.toThrow("Expert 'gone' is not installed");
});
