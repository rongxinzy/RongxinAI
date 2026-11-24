import { PiAssistantStopReason, PiContentBlockType } from './piToolConstants';

export const isPiThinkingOnlyResponse = (message: { content?: unknown }): boolean =>
  Array.isArray(message.content) &&
  message.content.some(block => block?.type === PiContentBlockType.Thinking) &&
  !message.content.some(
    block =>
      block?.type === PiContentBlockType.ToolCall ||
      (block?.type === PiContentBlockType.Text &&
        typeof block.text === 'string' &&
        block.text.trim()),
  );

export const isPiFinalResponse = (message: { stopReason?: string; content?: unknown }): boolean =>
  message.stopReason === PiAssistantStopReason.Stop &&
  !isPiThinkingOnlyResponse(message) &&
  !(
    Array.isArray(message.content) &&
    message.content.some(block => block?.type === PiContentBlockType.ToolCall)
  );

export const invalidatesPiFinalResponse = (message: {
  stopReason?: string;
  content?: unknown;
}): boolean =>
  message.stopReason === PiAssistantStopReason.Aborted ||
  message.stopReason === PiAssistantStopReason.Error ||
  message.stopReason === PiAssistantStopReason.Length ||
  message.stopReason === PiAssistantStopReason.ToolUse ||
  (message.stopReason === PiAssistantStopReason.Stop && isPiThinkingOnlyResponse(message)) ||
  (Array.isArray(message.content) &&
    message.content.some(block => block?.type === PiContentBlockType.ToolCall));
