import { PiAssistantStopReason, PiContentBlockType } from './piWriteTokenLimit';

export const isPiFinalResponse = (message: { stopReason?: string; content?: unknown }): boolean =>
  message.stopReason === PiAssistantStopReason.Stop &&
  !(
    Array.isArray(message.content) &&
    message.content.some(block => block?.type === PiContentBlockType.ToolCall)
  );

export const invalidatesPiFinalResponse = (message: {
  stopReason?: string;
  content?: unknown;
}): boolean =>
  message.stopReason === PiAssistantStopReason.ToolUse ||
  (Array.isArray(message.content) &&
    message.content.some(block => block?.type === PiContentBlockType.ToolCall));
