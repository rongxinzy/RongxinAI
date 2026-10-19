import {
  parseLegacyScheduledReminderSystemMessage,
  parseScheduledReminderPrompt,
  parseSimpleScheduledReminderText,
} from '../../scheduledTask/reminderText';

/**
 * Identifies transcript turns that were triggered by the scheduled-task
 * engine (cron reminder runs), so their replies may be delivered back to the
 * originating IM conversation. Only user and system messages are considered —
 * tool_use/tool_result/assistant messages may quote reminder text from task
 * payloads, which would flag user-initiated turns as reminder runs.
 */
export function isReminderSystemTurn(messages: Array<{ type: string; content: string }>): boolean {
  return messages.some(message => {
    const content = typeof message.content === 'string' ? message.content : '';
    if (message.type !== 'user' && message.type !== 'system') {
      return false;
    }
    if (message.type === 'system') {
      return (
        parseSimpleScheduledReminderText(content) !== null ||
        parseLegacyScheduledReminderSystemMessage(content) !== null
      );
    }
    return (
      parseScheduledReminderPrompt(content) !== null ||
      parseSimpleScheduledReminderText(content) !== null
    );
  });
}
