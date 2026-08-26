import { describe, expect, test } from 'vitest';

import {
  ExternalModelProtocol,
  ExternalModelThinkingFormat,
  type ExternalModel,
} from '../../shared/externalModels';
import { ProviderModelPiThinkingFormat } from '../../shared/providers';
import { resolveExternalModelRuntime } from './externalModelRuntime';

describe('resolveExternalModelRuntime', () => {
  test('maps DeepSeek reasoning compatibility into the internal runtime', () => {
    expect(resolveExternalModelRuntime(fixtureModel())).toEqual({
      reasoning: true,
      compat: {
        thinkingFormat: ProviderModelPiThinkingFormat.DeepSeek,
        supportsReasoningEffort: true,
        requiresReasoningContentOnAssistantMessages: true,
      },
    });
  });

  test('leaves models without reasoning compatibility unchanged', () => {
    expect(resolveExternalModelRuntime(fixtureModel(false))).toBeUndefined();
  });
});

function fixtureModel(reasoning = true): ExternalModel {
  return {
    id: 'assigned-model',
    displayName: 'Assigned Model',
    protocol: ExternalModelProtocol.OpenAICompatible,
    ...(reasoning
      ? {
          reasoningCompatibility: {
            thinkingFormat: ExternalModelThinkingFormat.DeepSeek,
            supportsReasoningEffort: true,
            requiresReasoningContentOnAssistantMessages: true,
          },
        }
      : {}),
    provider: { id: 'external.fixture', displayName: 'Fixture Gateway' },
  };
}
