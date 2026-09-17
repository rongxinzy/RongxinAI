import { expect, test } from 'vitest';
import { invalidatesPiFinalResponse, isPiFinalResponse } from './piFinalResponse';
import { PiAssistantStopReason, PiContentBlockType } from './piWriteTokenLimit';

test('tool-call preambles are not final answers even if the provider reports stop', () => {
  expect(
    isPiFinalResponse({
      stopReason: PiAssistantStopReason.Stop,
      content: [
        { type: PiContentBlockType.Text, text: 'I need to set the fill type.' },
        { type: PiContentBlockType.ToolCall, name: 'edit' },
      ],
    }),
  ).toBe(false);
});
test('only a terminal response qualifies as a final answer', () => {
  expect(
    isPiFinalResponse({
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.Text, text: 'Final report' }],
    }),
  ).toBe(true);
  expect(isPiFinalResponse({ stopReason: PiAssistantStopReason.Length })).toBe(false);
  expect(isPiFinalResponse({ stopReason: PiAssistantStopReason.Error })).toBe(false);
  expect(isPiFinalResponse({})).toBe(false);
});

test('tool responses invalidate an earlier final answer but trailing reasoning preserves it', () => {
  expect(invalidatesPiFinalResponse({ stopReason: PiAssistantStopReason.ToolUse })).toBe(true);
  expect(
    invalidatesPiFinalResponse({
      stopReason: PiAssistantStopReason.Stop,
      content: [{ type: PiContentBlockType.ToolCall }],
    }),
  ).toBe(true);
  expect(invalidatesPiFinalResponse({ stopReason: PiAssistantStopReason.Length })).toBe(false);
});
