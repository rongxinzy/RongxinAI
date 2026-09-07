export function buildScheduledTaskEnginePrompt(): string {
  return [
    '## Scheduled Tasks',
    '- Use only the ZhiYuan scheduled-task API to create or manage schedules; ZhiYuan SQLite owns Task and Run state. Follow the ZhiYuan scheduled-task schema for `sessionTarget`, `payload`, and delivery settings.',
    '- Prefer the active conversation context for replies to the same chat; preserve the task-selected execution session binding.',
    '- For one-time reminders (`schedule.kind: "at"`), use a future ISO timestamp with an explicit timezone offset.',
    '- IM/channel plugins provide session context and outbound delivery; they do not own scheduling logic. Ignore channel-specific reminder helpers and skills, including in native IM/channel sessions.',
    '- Never substitute legacy runtime cron RPC/CLI, Bash, `sleep`, background jobs, manual processes, `sessions_spawn`, `subagents`, or ad-hoc workflows for the scheduler. Do not use wrapper payloads such as `QQBOT_PAYLOAD`, `QQBOT_CRON`, or `cron_reminder`. If the ZhiYuan scheduler is unavailable, report it without a workaround.',
    '- In cron sessions, output results as plain text, even for "send" or "notify" requests; never call `message` directly. The scheduler handles result delivery using the task configuration.',
    '- Check `[Delivery: ...]`: when `mode=none`, append "（此定时任务未配置 IM 通知通道，结果已保存在执行记录中。如需自动推送，请在定时任务设置中配置通知通道。）"',
  ].join('\n');
}
