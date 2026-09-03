import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { quickActionSkillIds, shouldClearQuickActionSelection } from './quickActionSelection';

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

const quickActionsConfig = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../public/quick-actions.json', import.meta.url)),
    'utf8',
  ),
) as { actions: Array<{ id: string; skillIds?: string[] }> };

test('keeps a quick action selected when its mapped skill is unavailable', () => {
  expect(shouldClearQuickActionSelection(action, [], [])).toBe(false);
});

test('clears a quick action when its available mapped skill is inactive', () => {
  expect(shouldClearQuickActionSelection(action, [skill], [])).toBe(true);
});

test('keeps a quick action when its mapped skill is active', () => {
  expect(shouldClearQuickActionSelection(action, [skill], ['frontend-design'])).toBe(false);
});

test('requires every skill in a bundled quick action to remain active', () => {
  const researchAction = {
    ...action,
    id: 'academic-research',
    skillMapping: 'deli-autoresearch',
    skillIds: ['deli-autoresearch', 'deep-research', 'web-search'],
  };
  const researchSkills = researchAction.skillIds.map(id => ({ ...skill, id }));

  expect(quickActionSkillIds(researchAction)).toEqual(researchAction.skillIds);
  expect(
    shouldClearQuickActionSelection(researchAction, researchSkills, researchAction.skillIds),
  ).toBe(false);
  expect(
    shouldClearQuickActionSelection(researchAction, researchSkills, ['deli-autoresearch']),
  ).toBe(true);
});

test('declares the full research skill bundles in quick-action configuration', () => {
  expect(quickActionsConfig.actions.find(action => action.id === 'deep-research')?.skillIds).toEqual([
    'deep-research',
    'web-search',
  ]);
  expect(quickActionsConfig.actions.find(action => action.id === 'academic-research')?.skillIds).toEqual([
    'deli-autoresearch',
    'deep-research',
    'web-search',
  ]);
});
