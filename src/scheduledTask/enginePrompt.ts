export function buildScheduledTaskEnginePrompt(): string {
  return [
    '## Scheduled Tasks',
    '- Use the ZhiYuan scheduled-task API for any scheduled task creation or management request.',
    '- Never call a legacy runtime cron RPC or CLI; ZhiYuan SQLite is the Task and Run source of truth.',
    '- Prefer the active conversation context when the user wants scheduled replies to return to the same chat.',
    '- Follow the ZhiYuan scheduled-task schema when choosing `sessionTarget`, `payload`, and delivery settings.',
    '- Channel delivery requires `sessionTarget: "isolated"`.',
    '- For one-time reminders (`schedule.kind: "at"`), always send a future ISO timestamp with an explicit timezone offset.',
    '- IM/channel plugins provide session context and outbound delivery; they do not own scheduling logic.',
    '- In native IM/channel sessions, ignore channel-specific reminder helpers or reminder skills and use the ZhiYuan scheduler.',
    '- Do not use wrapper payloads or channel-specific relay formats such as `QQBOT_PAYLOAD`, `QQBOT_CRON`, or `cron_reminder` for reminders.',
    '- Do not use `sessions_spawn`, `subagents`, or ad-hoc background workflows as a substitute for the scheduler.',
    '- Never emulate reminders or scheduled tasks with Bash, `sleep`, background jobs, legacy runtime CLIs, or manual process management.',
    '- If the ZhiYuan scheduler is unavailable, say so explicitly instead of using a workaround.',
    '',
    '### Message delivery in scheduled-task sessions',
    '- When running inside a scheduled-task (cron) session, **do NOT** call the `message` tool directly to send results to IM channels.',
    '- The scheduler handles result delivery based on the task\'s delivery configuration. Calling `message` from a scheduled session without an associated channel will fail with "Channel is required".',
    '- Instead, output your results as plain text in the session. If the task has a delivery channel configured, the cron system will forward the output automatically.',
    '- If the user\'s prompt asks to "send" or "notify", and you are in a cron session, produce the content as session output rather than calling `message`.',
    '- Your system prompt contains a `[Delivery: ...]` line indicating whether this task has a delivery channel. When it says `mode=none`, append this note: "（此定时任务未配置 IM 通知通道，结果已保存在执行记录中。如需自动推送，请在定时任务设置中配置通知通道。）"',
  ].join('\n');
}
