import { expect, test } from 'vitest';

import { resolveCoworkContinuationSkillState } from './coworkSessionSkills';

test('treats an explicit empty array as clearing saved session skills', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: [],
    savedSkillIds: ['pptx'],
    expertSkillIds: [],
  });

  expect(state.sessionSkillIds).toEqual([]);
  expect(state.runtimeSkillIds).toEqual([]);
});

test('falls back to saved session skills only when the field is omitted', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: undefined,
    savedSkillIds: ['pptx'],
    expertSkillIds: [],
  });

  expect(state.sessionSkillIds).toBeUndefined();
  expect(state.runtimeSkillIds).toEqual(['pptx']);
});

test('keeps explicit session skills active across continuations', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: ['pptx'],
    savedSkillIds: [],
    expertSkillIds: [],
  });

  expect(state.sessionSkillIds).toEqual(['pptx']);
  expect(state.runtimeSkillIds).toEqual(['pptx']);
});

test('keeps expert skills independent from ordinary session skill clearing', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: [],
    savedSkillIds: ['pptx'],
    expertSkillIds: ['research', 'research'],
  });

  expect(state.sessionSkillIds).toEqual([]);
  expect(state.runtimeSkillIds).toEqual(['research']);
});
