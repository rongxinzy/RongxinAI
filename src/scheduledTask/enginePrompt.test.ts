import { expect, test } from 'vitest';
import { buildScheduledTaskEnginePrompt } from './enginePrompt';

test('scheduled prompt directs native tasks, explicit timestamps, and local run records', () => {
  const prompt = buildScheduledTaskEnginePrompt();
  expect(prompt).toContain('scheduled_task tool');
  expect(prompt).toContain('native tasks');
  expect(prompt).toContain('future ISO timestamp with an explicit timezone offset');
  expect(prompt).toContain('local workbench');
  expect(prompt).not.toMatch(/ZhiYuan SQLite|IM|channel|QQBOT|delivery settings/);
});
