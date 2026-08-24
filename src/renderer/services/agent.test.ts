import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./agent.ts', import.meta.url)), 'utf8');

test('keeps expert package skills out of the visible active-skill selection', () => {
  const start = source.indexOf('switchAgent(agentId: string): void');
  const end = source.indexOf('\n  }\n}', start);
  const switchAgent = source.slice(start, end);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  expect(switchAgent).toContain('agent?.source === CoworkSessionExpertSource.Package');
  expect(switchAgent).toContain('agent?.source === CoworkSessionExpertSource.Member');
  expect(switchAgent).toContain('agent?.skillIds?.length && !isExpertAgent');
  expect(switchAgent).toContain('dispatch(clearActiveSkills());');
});
