export function buildScheduledTaskEnginePrompt(): string {
  return [
    '## Scheduled Tasks',
    '- Use the scheduled_task tool to create schedules. The application runs schedules with Pi Durable native tasks and persists their checkpoints.',
    '- For one-time reminders (`schedule.kind: "at"`), use a future ISO timestamp with an explicit timezone offset.',
    '- Tasks inherit the selected workspace and run in their own task conversation. Results are saved in the local workbench and execution records.',
    '- If the scheduled_task tool is unavailable, report that scheduling is unavailable. Do not create an alternative scheduler with shell sleep, background jobs, or manual processes.',
  ].join('\n');
}
