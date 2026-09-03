import { expect, test } from 'vitest';

import {
  resolveDiscoveredModelContext,
  resolveOllamaRunningModelContext,
} from './ollamaRuntimeMetadata';

test('uses the context length of the matching running Ollama model', () => {
  expect(
    resolveOllamaRunningModelContext('Qwen3:32B', [
      { name: 'qwen3:8b', context_length: 131_072 },
      { model: 'qwen3:32b', context_length: 262_144 },
    ]),
  ).toBe(262_144);
});

test('ignores invalid or non-matching runtime context lengths', () => {
  expect(
    resolveOllamaRunningModelContext('qwen3:32b', [
      { name: 'qwen3:32b', context_length: 0 },
      { name: 'qwen3:8b', context_length: 262_144 },
    ]),
  ).toBeUndefined();
});

test('uses the configured provider discovery context for a matching model', () => {
  expect(
    resolveDiscoveredModelContext('qwen3:32b', [
      { id: 'qwen3:32b', contextWindow: 262_144 },
    ]),
  ).toBe(262_144);
});
