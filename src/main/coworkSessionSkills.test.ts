import { expect, test } from 'vitest';

import { resolveCoworkContinuationSkillState } from './coworkSessionSkills';

test('keeps the session skills when this input attaches nothing', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: [],
    savedSkillIds: ['pptx'],
    expertSkillIds: [],
  });

  expect(state.sessionSkillIds).toEqual(['pptx']);
  expect(state.runtimeSkillIds).toEqual(['pptx']);
});

test('adds this input picks to the session skills', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: ['docx', 'pptx'],
    savedSkillIds: ['pptx'],
    expertSkillIds: [],
  });

  expect(state.sessionSkillIds).toEqual(['pptx', 'docx']);
  expect(state.runtimeSkillIds).toEqual(['pptx', 'docx']);
});

test('keeps saved session skills when the field is omitted', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: undefined,
    savedSkillIds: ['pptx'],
    expertSkillIds: [],
  });

  expect(state.sessionSkillIds).toEqual(['pptx']);
  expect(state.runtimeSkillIds).toEqual(['pptx']);
});

test('keeps expert skills independent from the session skill set', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: [],
    savedSkillIds: ['pptx'],
    expertSkillIds: ['research', 'research'],
  });

  expect(state.sessionSkillIds).toEqual(['pptx']);
  expect(state.runtimeSkillIds).toEqual(['pptx', 'research']);
});

test('starts a session with no skills when nothing was attached', () => {
  const state = resolveCoworkContinuationSkillState({
    activeSkillIds: [],
    savedSkillIds: undefined,
    expertSkillIds: [],
  });

  expect(state.sessionSkillIds).toEqual([]);
  expect(state.runtimeSkillIds).toEqual([]);
});
