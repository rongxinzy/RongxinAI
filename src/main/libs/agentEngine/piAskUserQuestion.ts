import { Type } from 'typebox';

export const PiAskUserQuestionToolName = 'AskUserQuestion' as const;
export const PiAskUserQuestionTimeoutMs = 600_000;
export const PiAskUserQuestionSystemPrompt = [
  '## User Interaction',
  '',
  '- Before deleting files or directories, call AskUserQuestion and wait for the user response.',
  '- Use AskUserQuestion for user choices whenever it is available; do not replace it with a plain-text question.',
].join('\n');

const QuestionOptionSchema = Type.Object({
  label: Type.String(),
  description: Type.Optional(Type.String()),
});

const QuestionSchema = Type.Object({
  question: Type.String(),
  header: Type.Optional(Type.String()),
  options: Type.Array(QuestionOptionSchema, { minItems: 2, maxItems: 4 }),
  multiSelect: Type.Optional(Type.Boolean()),
});

export const PiAskUserQuestionParameters = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 4 }),
});

export type PiAskUserQuestionInput = {
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
};

export type PiAskUserQuestionResponse = {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  message?: string;
};

export type PiAskUserQuestionRequester = (
  toolCallId: string,
  input: PiAskUserQuestionInput,
  signal?: AbortSignal,
) => Promise<PiAskUserQuestionResponse>;

export const createPiAskUserQuestionTool = (
  request: PiAskUserQuestionRequester,
): Record<string, unknown> => ({
  name: PiAskUserQuestionToolName,
  label: 'Ask User Question',
  description:
    'Ask the user a structured question and wait for a choice. ' +
    'You MUST use this before any delete operation, including rm, del, rmdir, unlink, trash, or git clean.',
  promptSnippet: 'Ask the user a structured question before destructive actions',
  parameters: PiAskUserQuestionParameters,
  executionMode: 'sequential',
  execute: async (
    toolCallId: string,
    params: PiAskUserQuestionInput,
    signal?: AbortSignal,
  ) => {
    const response = await request(toolCallId, params, signal);
    if (response.behavior === 'deny') {
      return {
        content: [{ type: 'text', text: response.message || 'The user denied the operation.' }],
        details: { behavior: 'deny' },
      };
    }

    const answers = response.updatedInput?.answers;
    const answerText =
      answers && typeof answers === 'object'
        ? Object.entries(answers)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([question, answer]) => `${question}: ${answer}`)
            .join('\n')
        : '';

    return {
      content: [{ type: 'text', text: answerText || 'The user approved the operation.' }],
      details: { behavior: 'allow', answers },
    };
  },
});
