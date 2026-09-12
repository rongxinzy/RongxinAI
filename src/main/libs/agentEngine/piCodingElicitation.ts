import { Type } from 'typebox';

export const PiCodingElicitationToolName = 'RequestCodingInput' as const;

export const PiCodingElicitationParameters = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 4000 }),
});

export type PiCodingElicitationInput = { question: string };
export type PiCodingElicitationResponse =
  | { cancelled: false; answer: string }
  | { cancelled: true; reason: string };

export type PiCodingElicitationRequester = (
  toolCallId: string,
  input: PiCodingElicitationInput,
  signal?: AbortSignal,
) => Promise<PiCodingElicitationResponse>;

/** A coding-only free-text pause point. This deliberately is not a permission tool. */
export const createPiCodingElicitationTool = (
  request: PiCodingElicitationRequester,
): Record<string, unknown> => ({
  name: PiCodingElicitationToolName,
  label: 'Request coding input',
  description:
    'Ask the user one concise free-text question and wait for the answer before continuing.',
  promptSnippet: 'Ask the user a free-text coding question and wait for the answer',
  parameters: PiCodingElicitationParameters,
  executionMode: 'sequential',
  execute: async (toolCallId: string, input: PiCodingElicitationInput, signal?: AbortSignal) => {
    const response = await request(toolCallId, input, signal);
    if ('answer' in response) {
      return { content: [{ type: 'text', text: response.answer }], details: { cancelled: false } };
    }
    return { content: [{ type: 'text', text: response.reason }], details: { cancelled: true } };
  },
});
