import { expect, test } from 'vitest';

import { buildScheduledTaskEnginePrompt } from './enginePrompt';

test('prompt keeps scheduled task ownership in ZhiYuan SQLite', () => {
  const prompt = buildScheduledTaskEnginePrompt();

  expect(prompt).toMatch(/ZhiYuan scheduled-task API/i);
  expect(prompt).toMatch(/never substitute legacy runtime cron RPC\/CLI/i);
  expect(prompt).toMatch(/active conversation context/i);
  expect(prompt).toMatch(/follow the ZhiYuan scheduled-task schema/i);
  expect(prompt).toMatch(
    /one-time reminders .*future iso timestamp with an explicit timezone offset/i,
  );
  expect(prompt).toMatch(
    /plugins provide session context and outbound delivery; they do not own scheduling logic/i,
  );
  expect(prompt).toMatch(
    /ignore channel-specific reminder helpers and skills.*native im\/channel sessions/i,
  );
  expect(prompt).toMatch(/do not use wrapper payloads .*qqbot_payload.*qqbot_cron.*cron_reminder/i);
  expect(prompt).toMatch(/never substitute.*`sessions_spawn`, `subagents`.*for the scheduler/i);
  expect(prompt).toMatch(/never substitute.*bash.*sleep.*background jobs.*manual processes/i);
  expect(prompt).toMatch(/if the ZhiYuan scheduler is unavailable/i);

  // Message delivery guard for cron sessions
  expect(prompt).toMatch(/never call `message` directly/i);
  expect(prompt).toMatch(/scheduler handles result delivery/i);
  expect(prompt).toMatch(/output results as plain text.*send.*notify/i);
  expect(prompt).toContain('mode=none');
  expect(prompt).toContain('此定时任务未配置 IM 通知通道');
  expect(prompt).toContain('preserve the task-selected execution session binding');
});

test('scheduled task prompt does not instruct an engine switch', () => {
  const prompt = buildScheduledTaskEnginePrompt();

  expect(prompt).not.toMatch(/switch the agent engine/i);
  expect(prompt).not.toMatch(
    /do not attempt to create, update, list, enable, disable, or delete scheduled tasks/i,
  );
});
