import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./cowork.ts', import.meta.url)), 'utf8');

test('does not reattach a session\'s completed skills when loading that session', () => {
  const loadSessionStart = source.indexOf('async loadSession(sessionId: string)');
  const loadSessionEnd = source.indexOf('\n  async ', loadSessionStart + 1);
  const loadSession = source.slice(loadSessionStart, loadSessionEnd);

  expect(loadSession).toContain('store.dispatch(clearActiveSkills());');
  expect(loadSession).not.toContain('setActiveSkillIds(result.session.activeSkillIds)');
});
