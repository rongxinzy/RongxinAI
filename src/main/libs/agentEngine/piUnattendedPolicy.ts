export const PiUnattendedSystemPrompt = [
  '## Unattended execution',
  '- No user interaction is available during this run. Do not ask the user questions or wait for input.',
  '- Make reasonable assumptions from the task and existing context.',
  '- Choose and execute the safest viable next action when details are ambiguous.',
  '- Stop only when external credentials or authorization are required and no progress is possible; report the blocker clearly.',
].join('\n');

export function shouldExposeAskUserQuestionTool(unattended: boolean): boolean {
  return !unattended;
}
