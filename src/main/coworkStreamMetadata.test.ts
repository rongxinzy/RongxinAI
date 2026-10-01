import { expect, test } from 'vitest';
import { getCoworkStreamMetadata } from './coworkStreamMetadata';

test('content updates preserve final flags and metrics without copying tool inputs or attachment bytes', () => {
  const metadata = {
    isFinal: true,
    isFinalAnswer: true,
    isThinking: false,
    usage: { totalTokens: 120 },
    contextUsage: { usedTokens: 100, contextWindowTokens: 1000 },
    metrics: { toolDurationMs: 50 },
    imageAttachments: [{ base64Data: 'x'.repeat(1_000_000) }],
    toolInput: { content: 'x'.repeat(1_000_000) },
    toolResult: 'x'.repeat(1_000_000),
  };
  expect(getCoworkStreamMetadata(metadata)).toEqual({
    isFinal: true,
    isFinalAnswer: true,
    isThinking: false,
    usage: { totalTokens: 120 },
    contextUsage: { usedTokens: 100, contextWindowTokens: 1000 },
    metrics: { toolDurationMs: 50 },
  });
});
