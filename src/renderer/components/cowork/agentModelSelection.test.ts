import { describe, expect, test } from 'vitest';

import { OpenClawProviderId, ProviderName } from '../../../shared/providers';
import type { Model } from '../../store/slices/modelSlice';
import { resolveAgentModelSelection, resolveEffectiveModel } from './agentModelSelection';

const models: Model[] = [
  { id: 'gpt-4o', name: 'GPT-4o', providerKey: 'openai' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', providerKey: 'anthropic' },
  { id: 'deepseek-v3.2', name: 'DeepSeek', providerKey: 'anthropic' },
  { id: 'deepseek-v3.2', name: 'DeepSeek Server', providerKey: 'openai', isServerModel: true },
];

const visionModel: Model = { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', providerKey: 'qwen', supportsImage: true };
const nonVisionModel: Model = { id: 'glm-5.1', name: 'GLM 5.1', providerKey: 'zhipu', supportsImage: false };
const ineligibleLlamaCppModel: Model = {
  id: 'qwen-local',
  name: 'qwen-local',
  providerKey: ProviderName.LlamaCpp,
};

describe('resolveAgentModelSelection', () => {
  test('uses explicit agent model when present', () => {
    const result = resolveAgentModelSelection({
      agentModel: 'anthropic/claude-sonnet-4',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('claude-sonnet-4');
    expect(result.usesFallback).toBe(false);
    expect(result.hasInvalidExplicitModel).toBe(false);
  });

  test('prefers explicit session model override over agent model', () => {
    const result = resolveAgentModelSelection({
      sessionModel: 'openai/gpt-4o',
      agentModel: 'anthropic/claude-sonnet-4',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('gpt-4o');
    expect(result.usesFallback).toBe(false);
    expect(result.hasInvalidExplicitModel).toBe(false);
  });

  test('falls back to the global model in openclaw when agent model is empty', () => {
    const result = resolveAgentModelSelection({
      agentModel: '',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('gpt-4o');
    expect(result.usesFallback).toBe(true);
    expect(result.hasInvalidExplicitModel).toBe(false);
  });

  test('preserves explicit model resolution for the only supported engine', () => {
    const result = resolveAgentModelSelection({
      agentModel: 'anthropic/claude-sonnet-4',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('claude-sonnet-4');
    expect(result.usesFallback).toBe(false);
    expect(result.hasInvalidExplicitModel).toBe(false);
  });

  test('silently falls back when agent model is invalid (not a session-level choice)', () => {
    const result = resolveAgentModelSelection({
      agentModel: 'deleted-model',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('gpt-4o');
    expect(result.usesFallback).toBe(true);
    expect(result.hasInvalidExplicitModel).toBe(false);
  });

  test('silently falls back when agent model is an ambiguous bare id', () => {
    const result = resolveAgentModelSelection({
      agentModel: 'deepseek-v3.2',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('gpt-4o');
    expect(result.usesFallback).toBe(true);
    expect(result.hasInvalidExplicitModel).toBe(false);
  });

  test('marks invalid session model override as error', () => {
    const result = resolveAgentModelSelection({
      sessionModel: 'deleted-provider/deleted-model',
      agentModel: 'anthropic/claude-sonnet-4',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('gpt-4o');
    expect(result.usesFallback).toBe(true);
    expect(result.hasInvalidExplicitModel).toBe(true);
  });

  test('keeps explicit llama.cpp selection for work chat', () => {
    const result = resolveAgentModelSelection({
      agentModel: `${OpenClawProviderId.LlamaCpp}/qwen-local`,
      availableModels: [...models, ineligibleLlamaCppModel],
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('qwen-local');
    expect(result.usesFallback).toBe(false);
    expect(result.hasInvalidExplicitModel).toBe(false);
    expect(result.hasIneligibleLlamaCppModel).toBe(false);
  });
});

describe('resolveEffectiveModel', () => {
  test('home page (no sessionId) uses globalSelectedModel even when agent model differs', () => {
    // Bug scenario: agent default model supports images, user picked a non-vision model in header
    const result = resolveEffectiveModel({
      sessionId: undefined,
      agentSelectedModel: visionModel,
      globalSelectedModel: nonVisionModel,
    });

    expect(result?.id).toBe('glm-5.1');
    expect(result?.supportsImage).toBe(false);
  });

  test('home page uses globalSelectedModel supportsImage=true when user picks vision model', () => {
    const result = resolveEffectiveModel({
      sessionId: undefined,
      agentSelectedModel: nonVisionModel,
      globalSelectedModel: visionModel,
    });

    expect(result?.id).toBe('qwen3.5-plus');
    expect(result?.supportsImage).toBe(true);
  });

  test('inside session (has sessionId) uses agentSelectedModel from session override', () => {
    const result = resolveEffectiveModel({
      sessionId: 'session-123',
      agentSelectedModel: nonVisionModel,
      globalSelectedModel: visionModel,
    });

    expect(result?.id).toBe('glm-5.1');
    expect(result?.supportsImage).toBe(false);
  });
});
