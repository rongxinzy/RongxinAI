import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./CoworkView.tsx', import.meta.url)), 'utf8');

test('sends the current session skill array on every engine continuation', () => {
  const continuationStart = source.indexOf('const handleContinueSession = async');
  const continuationEnd = source.indexOf('const handleStopSession = async', continuationStart);
  const continuation = source.slice(continuationStart, continuationEnd);

  expect(continuationStart).toBeGreaterThanOrEqual(0);
  expect(continuationEnd).toBeGreaterThan(continuationStart);
  expect(continuation).toContain('activeSkillIds: sessionSkillIds,');
  expect(continuation).not.toContain(
    'activeSkillIds: sessionSkillIds.length > 0 ? sessionSkillIds : undefined',
  );
});
