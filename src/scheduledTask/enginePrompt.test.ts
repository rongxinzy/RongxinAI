import { expect, test } from 'vitest';

import { CoworkManagedPromptMarker } from '../main/coworkPrompt/constants';
import { RetiredScheduledTaskPrompt, stripRetiredScheduledTaskPrompt } from './enginePrompt';

test('removes the retired desktop block and exact plain IM copies from saved prompts', () => {
  const { ScheduledTasksStart, ScheduledTasksEnd } = CoworkManagedPromptMarker;
  const block = [ScheduledTasksStart, RetiredScheduledTaskPrompt, ScheduledTasksEnd].join('\n');
  const stored = ['Expert instructions', block, RetiredScheduledTaskPrompt, 'Custom policy'].join(
    '\n',
  );
  expect(stripRetiredScheduledTaskPrompt(stored).split('\n').filter(Boolean)).toEqual([
    'Expert instructions',
    'Custom policy',
  ]);
});

test('preserves authored scheduling sections and incomplete markers', () => {
  const customPrompt = [
    CoworkManagedPromptMarker.ScheduledTasksStart,
    '## Scheduled Tasks',
    'Only schedule fiscal reviews on Fridays.',
  ].join('\n');
  expect(stripRetiredScheduledTaskPrompt(customPrompt)).toBe(customPrompt);
});
