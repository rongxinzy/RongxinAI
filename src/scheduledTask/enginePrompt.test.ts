import { expect, test } from 'vitest';

import { buildScheduledTaskEnginePrompt } from './enginePrompt';

test('prompt keeps scheduled task ownership in ZhiYuan rather than OpenClaw cron', () => {
  const prompt = buildScheduledTaskEnginePrompt();

  expect(prompt).toMatch(/ZhiYuan scheduled-task API/i);
  expect(prompt).toMatch(/Never call an OpenClaw `cron` RPC or CLI/i);
  expect(prompt).toMatch(/active conversation context/i);
  expect(prompt).toMatch(/follow the ZhiYuan scheduled-task schema/i);
  expect(prompt).toMatch(
    /one-time reminders .*future iso timestamp with an explicit timezone offset/i,
  );
  expect(prompt).toMatch(
    /plugins provide session context and outbound delivery; they do not own scheduling logic/i,
  );
  expect(prompt).toMatch(
    /native im\/channel sessions, ignore channel-specific reminder helpers or reminder skills/i,
  );
  expect(prompt).toMatch(/do not use wrapper payloads .*qqbot_payload.*qqbot_cron.*cron_reminder/i);
  expect(prompt).toMatch(
    /do not use `sessions_spawn`, `subagents`, or ad-hoc background workflows as a substitute for the scheduler/i,
  );
  expect(prompt).toMatch(/never emulate reminders .*bash.*sleep.*openclaw.*claw/i);
  expect(prompt).toMatch(/if the ZhiYuan scheduler is unavailable/i);

  // Message delivery guard for cron sessions
  expect(prompt).toMatch(/do NOT.*call the `message` tool directly/i);
  expect(prompt).toMatch(/scheduler handles result delivery/i);
  expect(prompt).toMatch(/Channel is required/i);
  expect(prompt).toMatch(/output your results as plain text/i);
});

test('scheduled task prompt does not instruct an engine switch', () => {
  const prompt = buildScheduledTaskEnginePrompt();

  expect(prompt).not.toMatch(/switch the agent engine/i);
  expect(prompt).not.toMatch(
    /do not attempt to create, update, list, enable, disable, or delete scheduled tasks/i,
  );
});
