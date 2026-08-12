import type { UIMessageChunk } from 'ai';

export const createToolInputStartChunk = (
  toolCallId: string,
  toolName: string,
): UIMessageChunk => ({
  type: 'tool-input-start',
  toolCallId,
  toolName,
});

export const createToolInputAvailableChunk = (
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
): UIMessageChunk => ({
  type: 'tool-input-available',
  toolCallId,
  toolName,
  input,
  providerExecuted: true,
});

export const createToolOutputAvailableChunk = (
  toolCallId: string,
  output: unknown,
): UIMessageChunk => ({
  type: 'tool-output-available',
  toolCallId,
  output,
  providerExecuted: true,
});

export const createToolOutputErrorChunk = (
  toolCallId: string,
  errorText: string,
): UIMessageChunk => ({
  type: 'tool-output-error',
  toolCallId,
  errorText,
  providerExecuted: true,
});
