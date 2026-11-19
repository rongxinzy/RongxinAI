import type { CoworkMessage } from '../coworkStore';

/** Only receipts tied to a scheduling call in this turn can affect the reply. */
export function readIMScheduledTaskReceipts(messages: readonly CoworkMessage[]): {
  created: boolean;
  failed: boolean;
} {
  const calls = new Set<string>();
  let created = false;
  let failed = false;
  for (const { type, metadata } of messages) {
    if (!metadata || typeof metadata.toolUseId !== 'string' || !metadata.toolUseId) continue;
    const callId = metadata.toolUseId;
    if (type === 'tool_use') {
      const name =
        typeof metadata.toolName === 'string' ? metadata.toolName.trim().toLowerCase() : '';
      const action = metadata.toolInput?.action;
      if (
        name === 'scheduled_task' ||
        (name === 'cron' && typeof action === 'string' && action.trim().toLowerCase() === 'add')
      ) {
        calls.add(callId);
      }
    } else if (type === 'tool_result' && calls.has(callId)) {
      created ||= metadata.isError === false;
      failed ||= metadata.isError === true;
    }
  }
  return { created, failed };
}
