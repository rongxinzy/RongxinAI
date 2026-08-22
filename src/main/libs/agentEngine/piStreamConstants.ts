export const PiAssistantEventType = {
  Start: 'start',
  TextStart: 'text_start',
  TextDelta: 'text_delta',
  TextEnd: 'text_end',
  ThinkingStart: 'thinking_start',
  ThinkingDelta: 'thinking_delta',
  ThinkingEnd: 'thinking_end',
} as const;

export const PiStreamSegmentKind = {
  Text: 'text',
  Thinking: 'thinking',
} as const;

export type PiStreamSegmentKind = (typeof PiStreamSegmentKind)[keyof typeof PiStreamSegmentKind];
