import { expect, test } from 'vitest';

import reducer, { activateSkill, setActiveSkillIds } from './skillSlice';

test('activateSkill adds an inactive skill exactly once', () => {
  let state = reducer(undefined, setActiveSkillIds([]));
  state = reducer(state, activateSkill('pdf'));
  expect(state.activeSkillIds).toEqual(['pdf']);
  state = reducer(state, activateSkill('pdf'));
  expect(state.activeSkillIds).toEqual(['pdf']);
});

test('activateSkill keeps already active skills and preserves order', () => {
  let state = reducer(undefined, setActiveSkillIds(['pdf', 'seedream']));
  state = reducer(state, activateSkill('pdf'));
  state = reducer(state, activateSkill('docx'));
  expect(state.activeSkillIds).toEqual(['pdf', 'seedream', 'docx']);
});
