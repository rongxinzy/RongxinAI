import { PiAssistantEventType } from './piStreamConstants';

/** True when message_update must not read the shared Pi partial snapshot. */
export function piAssistantEventIgnoresSnapshot(assistantEventType: string | undefined): boolean {
  if (!assistantEventType) return false;
  if (assistantEventType.startsWith('toolcall_')) return true;
  return (
    assistantEventType === PiAssistantEventType.TextStart ||
    assistantEventType === PiAssistantEventType.TextDelta ||
    assistantEventType === PiAssistantEventType.TextEnd ||
    assistantEventType === PiAssistantEventType.ThinkingStart ||
    assistantEventType === PiAssistantEventType.ThinkingDelta ||
    assistantEventType === PiAssistantEventType.ThinkingEnd
  );
}
