import { expect, test } from 'vitest';

import { shouldClearQuickActionSelection } from './quickActionSelection';

const action = {
  id: 'education',
  label: 'Education & Learning',
  icon: 'GraduationCap',
  color: '#10B981',
  skillMapping: 'frontend-design',
  prompts: [],
};

const skill = {
  id: 'frontend-design',
  name: 'Frontend Design',
  description: '',
  enabled: true,
  pinned: false,
  isOfficial: true,
  isBuiltIn: true,
  updatedAt: 0,
  prompt: '',
  skillPath: '',
};

test('keeps a quick action selected when its mapped skill is unavailable', () => {
  expect(shouldClearQuickActionSelection(action, [], [])).toBe(false);
});

test('clears a quick action when its available mapped skill is inactive', () => {
  expect(shouldClearQuickActionSelection(action, [skill], [])).toBe(true);
});

test('keeps a quick action when its mapped skill is active', () => {
  expect(shouldClearQuickActionSelection(action, [skill], ['frontend-design'])).toBe(false);
});
