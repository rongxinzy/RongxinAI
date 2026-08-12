import { expect, test } from 'vitest';

import { ProviderName } from '../../../shared/providers';
import type { Model } from '../../store/slices/modelSlice';
import { supportsLocalThinkingToggle } from './localThinking';

test('exposes the toggle when the running local model supports it', () => {
  const model: Model = {
    id: 'Qwen3-8B-Q4_K_M.gguf',
    name: 'Qwen3 8B',
    providerKey: ProviderName.LlamaCpp,
    supportsThinkingToggle: true,
  };

  expect(supportsLocalThinkingToggle(model)).toBe(true);
});

test('does not expose the toggle for an unsupported local model', () => {
  const model: Model = {
    id: 'Qwen3-8B-Q4_K_M.gguf',
    name: 'Qwen3 8B',
    providerKey: ProviderName.LlamaCpp,
    supportsThinkingToggle: false,
  };

  expect(supportsLocalThinkingToggle(model)).toBe(false);
});

test('does not expose the toggle for non-llama.cpp providers', () => {
  const model: Model = {
    id: 'Qwen3-8B-Q4_K_M.gguf',
    name: 'Qwen3 8B',
    providerKey: ProviderName.Ollama,
    supportsThinkingToggle: true,
  };

  expect(supportsLocalThinkingToggle(model)).toBe(false);
});
