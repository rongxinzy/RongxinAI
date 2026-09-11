import { expect, test } from 'vitest';

import { ApiError } from './api';
import { isToolCallUnsupportedError } from './toolCallUnsupported';

test('recognizes common tool-unsupported rejections', () => {
  const cases = [
    new ApiError('This model does not support tools', 400),
    new ApiError('{"error":{"message":"GLM does not support function calling"}}', 400),
    new ApiError('Tools are not supported by this endpoint', 400),
    new ApiError('"auto" tool choice requires --enable-auto-tool-choice', 400),
    new ApiError('{"message":"tool_choice is not supported for this model"}', 422),
    new ApiError('Function calling is not supported in this model', 404),
    // Streamed errors lose the status code; the message alone must suffice.
    new ApiError('This model does not support tool calls'),
  ];
  for (const error of cases) {
    expect(isToolCallUnsupportedError(error), error.message).toBe(true);
  }
});

test('does not misclassify unrelated failures', () => {
  const cases: unknown[] = [
    new ApiError('Internal server error', 500),
    new ApiError('Invalid API key', 401),
    new ApiError('The model `foo` does not exist', 404),
    new ApiError('Connection reset'),
    new Error('Unexpected stream end'),
    'plain string',
    null,
    undefined,
    // A 400 about an unrelated field is not a tool verdict.
    new ApiError('Invalid request: max_tokens is too large', 400),
  ];
  for (const error of cases) {
    expect(isToolCallUnsupportedError(error)).toBe(false);
  }
});
