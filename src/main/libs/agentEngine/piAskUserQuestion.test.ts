import { expect, test, vi } from 'vitest';

import {
  createPiAskUserQuestionTool,
  PiAskUserQuestionSystemPrompt,
  PiAskUserQuestionTimeoutMs,
} from './piAskUserQuestion';

const input = {
  questions: [
    {
      question: 'Continue?',
      options: [{ label: 'Yes' }, { label: 'No' }],
    },
  ],
};

test('returns the selected answers as a Pi tool result', async () => {
  const request = vi.fn().mockResolvedValue({
    behavior: 'allow',
    updatedInput: { answers: { 'Continue?': 'Yes' } },
  });
  const tool = createPiAskUserQuestionTool(request) as {
    execute: (id: string, value: typeof input) => Promise<{ content: Array<{ text: string }> }>;
  };

  const result = await tool.execute('tool-1', input);

  expect(request).toHaveBeenCalledWith('tool-1', input, undefined);
  expect(result.content[0]?.text).toBe('Continue?: Yes');
});

test('returns a denial as a Pi tool result', async () => {
  const tool = createPiAskUserQuestionTool(async () => ({
    behavior: 'deny' as const,
    message: 'The user denied the operation.',
  })) as {
    execute: (id: string, value: typeof input) => Promise<{ content: Array<{ text: string }> }>;
  };

  const result = await tool.execute('tool-1', input);

  expect(result.content[0]?.text).toBe('The user denied the operation.');
});

test('defines a ten-minute timeout and a system-level AskUserQuestion policy', () => {
  expect(PiAskUserQuestionTimeoutMs).toBe(600_000);
  expect(PiAskUserQuestionSystemPrompt).toContain('AskUserQuestion');
  expect(PiAskUserQuestionSystemPrompt).toContain('Before deleting files or directories');
});
