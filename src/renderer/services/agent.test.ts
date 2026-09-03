import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./agent.ts', import.meta.url)), 'utf8');

test('keeps expert package skills out of the visible active-skill selection', () => {
  const start = source.indexOf('switchAgent(agentId: string): void');
  const switchAgent = source.slice(start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(switchAgent).toContain('agent?.source === CoworkSessionExpertSource.Package');
  expect(switchAgent).toContain('agent?.source === CoworkSessionExpertSource.Member');
  expect(switchAgent).toContain('agent?.skillIds?.length && !isExpertAgent');
  expect(switchAgent).toContain('dispatch(clearActiveSkills());');
});

test('does not overwrite temporary prompt skills when only the model changes', () => {
  const start = source.indexOf('async updateAgent(');
  const end = source.indexOf('\n  async deleteAgent', start);
  const updateAgent = source.slice(start, end);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  expect(updateAgent).toContain(
    'id === store.getState().agent.currentAgentId && updates.skillIds !== undefined',
  );
});
