import { PiAssistantStopReason, PiContentBlockType } from './piToolConstants';

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
  message.stopReason === PiAssistantStopReason.Length ||
  message.stopReason === PiAssistantStopReason.Aborted ||
  message.stopReason === PiAssistantStopReason.Error ||
  message.stopReason === PiAssistantStopReason.ToolUse ||
  (Array.isArray(message.content) &&
    message.content.some(block => block?.type === PiContentBlockType.ToolCall));
