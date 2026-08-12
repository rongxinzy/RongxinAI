import { describe, expect, test } from 'vitest';

import {
  LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
  LlamaCppAgentEligibilityReason,
} from '../../shared/llamacpp';
import { ProviderName } from '../../shared/providers';
import type { Model } from '../store/slices/modelSlice';
import {
  buildAgentModelValidationTargets,
  AgentModelSupportReason,
  AgentModelValidationTargetKind,
  resolveDraftAgentModelRef,
  resolveFirstUnsupportedAgentModel,
  resolveAgentModelSupport,
  resolveAgentModelSupportMessageKey,
} from './agentModelSupport';

const baseModels: Model[] = [
  {
    id: 'qwen-local-ok',
    name: 'qwen-local-ok',
    providerKey: ProviderName.LlamaCpp,
    agentProviderId: ProviderName.LlamaCpp,
    llamaCppAgentEligibility: {
      eligible: true,
      reason: LlamaCppAgentEligibilityReason.Eligible,
      requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
      runtimeContextWindow: 32768,
      trainedContextWindow: 32768,
      canIncreaseContextWindow: false,
    },
  },
  {
    id: 'qwen-local-runtime-small',
    name: 'qwen-local-runtime-small',
    providerKey: ProviderName.LlamaCpp,
    agentProviderId: ProviderName.LlamaCpp,
    llamaCppAgentEligibility: {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.RuntimeContextTooSmall,
      runtimeContextWindow: 8192,
      trainedContextWindow: 32768,
      requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
      canIncreaseContextWindow: true,
    },
  },
  {
    id: 'qwen-local-trained-small',
    name: 'qwen-local-trained-small',
    providerKey: ProviderName.LlamaCpp,
    agentProviderId: ProviderName.LlamaCpp,
    llamaCppAgentEligibility: {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.TrainedContextTooSmall,
      runtimeContextWindow: 8192,
      trainedContextWindow: 16384,
      requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
      canIncreaseContextWindow: false,
    },
  },
  {
    id: 'qwen-local-context-unknown',
    name: 'qwen-local-context-unknown',
    providerKey: ProviderName.LlamaCpp,
    agentProviderId: ProviderName.LlamaCpp,
    llamaCppAgentEligibility: {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.RuntimeContextUnknown,
      trainedContextWindow: 32768,
      requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
      canIncreaseContextWindow: false,
    },
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    providerKey: ProviderName.OpenAI,
    agentProviderId: ProviderName.OpenAI,
  },
];

describe('resolveAgentModelSupport', () => {
  test('allows running local models with sufficient context', () => {
    expect(resolveAgentModelSupport('llamacpp/qwen-local-ok', baseModels)).toBe(
      AgentModelSupportReason.Supported,
    );
  });

  test('rejects unresolved local models as not running', () => {
    expect(resolveAgentModelSupport('llamacpp/qwen-local-missing', baseModels)).toBe(
      AgentModelSupportReason.LocalModelNotRunning,
    );
  });

  test('distinguishes runtime context too small', () => {
    expect(resolveAgentModelSupport('llamacpp/qwen-local-runtime-small', baseModels)).toBe(
      AgentModelSupportReason.LocalModelRuntimeContextTooSmall,
    );
  });

  test('distinguishes trained context too small', () => {
    expect(resolveAgentModelSupport('llamacpp/qwen-local-trained-small', baseModels)).toBe(
      AgentModelSupportReason.LocalModelTrainedContextTooSmall,
    );
  });

  test('distinguishes unknown runtime context', () => {
    expect(resolveAgentModelSupport('llamacpp/qwen-local-context-unknown', baseModels)).toBe(
      AgentModelSupportReason.LocalModelRuntimeContextUnknown,
    );
  });
});

describe('buildAgentModelValidationTargets', () => {
  test('uses fallback model when primary is empty', () => {
    expect(
      buildAgentModelValidationTargets({
        primaryModelRef: '',
        fallbackModelRef: 'openai/gpt-5.2',
      }),
    ).toEqual([
      {
        kind: AgentModelValidationTargetKind.Primary,
        modelRef: 'openai/gpt-5.2',
      },
    ]);
  });

  test('includes triage models when triage is enabled', () => {
    expect(
      buildAgentModelValidationTargets({
        primaryModelRef: 'openai/gpt-5.2',
        triageOverride: {
          enabled: true,
          lightModelRef: 'llamacpp/qwen-local-runtime-small',
          heavyModelRef: 'llamacpp/qwen-local-trained-small',
        },
      }),
    ).toEqual([
      {
        kind: AgentModelValidationTargetKind.Primary,
        modelRef: 'openai/gpt-5.2',
      },
      {
        kind: AgentModelValidationTargetKind.TriageLight,
        modelRef: 'llamacpp/qwen-local-runtime-small',
      },
      {
        kind: AgentModelValidationTargetKind.TriageHeavy,
        modelRef: 'llamacpp/qwen-local-trained-small',
      },
    ]);
  });

  test('deduplicates repeated model refs', () => {
    expect(
      buildAgentModelValidationTargets({
        primaryModelRef: 'llamacpp/qwen-local-runtime-small',
        triageOverride: {
          enabled: true,
          lightModelRef: 'llamacpp/qwen-local-runtime-small',
        },
      }),
    ).toEqual([
      {
        kind: AgentModelValidationTargetKind.Primary,
        modelRef: 'llamacpp/qwen-local-runtime-small',
      },
    ]);
  });
});

describe('resolveFirstUnsupportedAgentModel', () => {
  test('returns the first failing target', () => {
    expect(
      resolveFirstUnsupportedAgentModel(
        [
          {
            kind: AgentModelValidationTargetKind.Primary,
            modelRef: 'openai/gpt-5.2',
          },
          {
            kind: AgentModelValidationTargetKind.TriageLight,
            modelRef: 'llamacpp/qwen-local-runtime-small',
          },
          {
            kind: AgentModelValidationTargetKind.TriageHeavy,
            modelRef: 'llamacpp/qwen-local-trained-small',
          },
        ],
        baseModels,
      ),
    ).toEqual({
      modelRef: 'llamacpp/qwen-local-runtime-small',
      reason: AgentModelSupportReason.LocalModelRuntimeContextTooSmall,
      targetKind: AgentModelValidationTargetKind.TriageLight,
    });
  });
});

describe('resolveDraftAgentModelRef', () => {
  test('uses the selected model ref when a real model is selected', () => {
    expect(resolveDraftAgentModelRef(baseModels[4], '')).toBe('openai/gpt-5.2');
  });

  test('preserves unresolved explicit refs', () => {
    expect(
      resolveDraftAgentModelRef(
        { id: '__invalid__', name: 'missing-local' } as Model,
        'llamacpp/missing-local',
      ),
    ).toBe('llamacpp/missing-local');
  });

  test('returns empty when the selection is cleared', () => {
    expect(resolveDraftAgentModelRef(null, 'openai/gpt-5.2')).toBe('');
  });
});

describe('resolveAgentModelSupportMessageKey', () => {
  test('maps reasons to precise i18n keys', () => {
    expect(
      resolveAgentModelSupportMessageKey(AgentModelSupportReason.LocalModelNotRunning),
    ).toBe('agentLlamaCppModelNotRunningHint');
    expect(
      resolveAgentModelSupportMessageKey(
        AgentModelSupportReason.LocalModelRuntimeContextUnknown,
      ),
    ).toBe('agentLlamaCppContextUnknownHint');
    expect(
      resolveAgentModelSupportMessageKey(
        AgentModelSupportReason.LocalModelRuntimeContextTooSmall,
      ),
    ).toBe('agentLlamaCppContextTooSmallHint');
    expect(
      resolveAgentModelSupportMessageKey(
        AgentModelSupportReason.LocalModelTrainedContextTooSmall,
      ),
    ).toBe('agentLlamaCppTrainedContextTooSmallHint');
  });
});
