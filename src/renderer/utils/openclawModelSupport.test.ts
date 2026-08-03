import { describe, expect, test } from 'vitest';

import {
  LLAMACPP_OPENCLAW_MIN_CONTEXT_WINDOW,
  LlamaCppOpenClawEligibilityReason,
} from '../../shared/llamacpp';
import { ProviderName } from '../../shared/providers';
import type { Model } from '../store/slices/modelSlice';
import {
  buildOpenClawModelValidationTargets,
  OpenClawModelSupportReason,
  OpenClawModelValidationTargetKind,
  resolveDraftOpenClawModelRef,
  resolveFirstUnsupportedOpenClawModel,
  resolveOpenClawModelSupport,
  resolveOpenClawModelSupportMessageKey,
} from './openclawModelSupport';

const baseModels: Model[] = [
  {
    id: 'qwen-local-ok',
    name: 'qwen-local-ok',
    providerKey: ProviderName.LlamaCpp,
    openClawProviderId: ProviderName.LlamaCpp,
    capabilities: { toolCalling: 'supported' },
    llamaCppOpenClawEligibility: {
      eligible: true,
      reason: LlamaCppOpenClawEligibilityReason.Eligible,
      requiredContextWindow: LLAMACPP_OPENCLAW_MIN_CONTEXT_WINDOW,
      runtimeContextWindow: 32768,
      trainedContextWindow: 32768,
      canIncreaseContextWindow: false,
    },
  },
  {
    id: 'qwen-local-runtime-small',
    name: 'qwen-local-runtime-small',
    providerKey: ProviderName.LlamaCpp,
    openClawProviderId: ProviderName.LlamaCpp,
    llamaCppOpenClawEligibility: {
      eligible: false,
      reason: LlamaCppOpenClawEligibilityReason.RuntimeContextTooSmall,
      runtimeContextWindow: 8192,
      trainedContextWindow: 32768,
      requiredContextWindow: LLAMACPP_OPENCLAW_MIN_CONTEXT_WINDOW,
      canIncreaseContextWindow: true,
    },
  },
  {
    id: 'qwen-local-trained-small',
    name: 'qwen-local-trained-small',
    providerKey: ProviderName.LlamaCpp,
    openClawProviderId: ProviderName.LlamaCpp,
    llamaCppOpenClawEligibility: {
      eligible: false,
      reason: LlamaCppOpenClawEligibilityReason.TrainedContextTooSmall,
      runtimeContextWindow: 8192,
      trainedContextWindow: 16384,
      requiredContextWindow: LLAMACPP_OPENCLAW_MIN_CONTEXT_WINDOW,
      canIncreaseContextWindow: false,
    },
  },
  {
    id: 'qwen-local-context-unknown',
    name: 'qwen-local-context-unknown',
    providerKey: ProviderName.LlamaCpp,
    openClawProviderId: ProviderName.LlamaCpp,
    llamaCppOpenClawEligibility: {
      eligible: false,
      reason: LlamaCppOpenClawEligibilityReason.RuntimeContextUnknown,
      trainedContextWindow: 32768,
      requiredContextWindow: LLAMACPP_OPENCLAW_MIN_CONTEXT_WINDOW,
      canIncreaseContextWindow: false,
    },
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    providerKey: ProviderName.OpenAI,
    openClawProviderId: ProviderName.OpenAI,
  },
];

describe('resolveOpenClawModelSupport', () => {
  test('allows running local models with sufficient context', () => {
    expect(resolveOpenClawModelSupport('llamacpp/qwen-local-ok', baseModels)).toBe(
      OpenClawModelSupportReason.Supported,
    );
  });

  test('rejects unresolved local models as not running', () => {
    expect(resolveOpenClawModelSupport('llamacpp/qwen-local-missing', baseModels)).toBe(
      OpenClawModelSupportReason.LocalModelNotRunning,
    );
  });

  test('distinguishes runtime context too small', () => {
    expect(resolveOpenClawModelSupport('llamacpp/qwen-local-runtime-small', baseModels)).toBe(
      OpenClawModelSupportReason.LocalModelRuntimeContextTooSmall,
    );
  });

  test('distinguishes trained context too small', () => {
    expect(resolveOpenClawModelSupport('llamacpp/qwen-local-trained-small', baseModels)).toBe(
      OpenClawModelSupportReason.LocalModelTrainedContextTooSmall,
    );
  });

  test('distinguishes unknown runtime context', () => {
    expect(resolveOpenClawModelSupport('llamacpp/qwen-local-context-unknown', baseModels)).toBe(
      OpenClawModelSupportReason.LocalModelRuntimeContextUnknown,
    );
  });

  test('rejects local models without confirmed tool calling support', () => {
    const model = {
      ...baseModels[0],
      id: 'qwen-local-unknown-tools',
      capabilities: {},
    };
    expect(resolveOpenClawModelSupport('llamacpp/qwen-local-unknown-tools', [model])).toBe(
      OpenClawModelSupportReason.LocalModelToolCallingUnknown,
    );
  });

  test('rejects local models explicitly marked without tool calling', () => {
    const model = {
      ...baseModels[0],
      id: 'qwen-local-no-tools',
      capabilities: { toolCalling: 'unsupported' as const },
    };
    expect(resolveOpenClawModelSupport('llamacpp/qwen-local-no-tools', [model])).toBe(
      OpenClawModelSupportReason.LocalModelToolCallingUnsupported,
    );
  });
});

describe('buildOpenClawModelValidationTargets', () => {
  test('uses fallback model when primary is empty', () => {
    expect(
      buildOpenClawModelValidationTargets({
        primaryModelRef: '',
        fallbackModelRef: 'openai/gpt-5.2',
      }),
    ).toEqual([
      {
        kind: OpenClawModelValidationTargetKind.Primary,
        modelRef: 'openai/gpt-5.2',
      },
    ]);
  });

  test('includes triage models when triage is enabled', () => {
    expect(
      buildOpenClawModelValidationTargets({
        primaryModelRef: 'openai/gpt-5.2',
        triageOverride: {
          enabled: true,
          lightModelRef: 'llamacpp/qwen-local-runtime-small',
          heavyModelRef: 'llamacpp/qwen-local-trained-small',
        },
      }),
    ).toEqual([
      {
        kind: OpenClawModelValidationTargetKind.Primary,
        modelRef: 'openai/gpt-5.2',
      },
      {
        kind: OpenClawModelValidationTargetKind.TriageLight,
        modelRef: 'llamacpp/qwen-local-runtime-small',
      },
      {
        kind: OpenClawModelValidationTargetKind.TriageHeavy,
        modelRef: 'llamacpp/qwen-local-trained-small',
      },
    ]);
  });

  test('deduplicates repeated model refs', () => {
    expect(
      buildOpenClawModelValidationTargets({
        primaryModelRef: 'llamacpp/qwen-local-runtime-small',
        triageOverride: {
          enabled: true,
          lightModelRef: 'llamacpp/qwen-local-runtime-small',
        },
      }),
    ).toEqual([
      {
        kind: OpenClawModelValidationTargetKind.Primary,
        modelRef: 'llamacpp/qwen-local-runtime-small',
      },
    ]);
  });
});

describe('resolveFirstUnsupportedOpenClawModel', () => {
  test('returns the first failing target', () => {
    expect(
      resolveFirstUnsupportedOpenClawModel(
        [
          {
            kind: OpenClawModelValidationTargetKind.Primary,
            modelRef: 'openai/gpt-5.2',
          },
          {
            kind: OpenClawModelValidationTargetKind.TriageLight,
            modelRef: 'llamacpp/qwen-local-runtime-small',
          },
          {
            kind: OpenClawModelValidationTargetKind.TriageHeavy,
            modelRef: 'llamacpp/qwen-local-trained-small',
          },
        ],
        baseModels,
      ),
    ).toEqual({
      modelRef: 'llamacpp/qwen-local-runtime-small',
      reason: OpenClawModelSupportReason.LocalModelRuntimeContextTooSmall,
      targetKind: OpenClawModelValidationTargetKind.TriageLight,
    });
  });
});

describe('resolveDraftOpenClawModelRef', () => {
  test('uses the selected model ref when a real model is selected', () => {
    expect(resolveDraftOpenClawModelRef(baseModels[4], '')).toBe('openai/gpt-5.2');
  });

  test('preserves unresolved explicit refs', () => {
    expect(
      resolveDraftOpenClawModelRef(
        { id: '__invalid__', name: 'missing-local' } as Model,
        'llamacpp/missing-local',
      ),
    ).toBe('llamacpp/missing-local');
  });

  test('returns empty when the selection is cleared', () => {
    expect(resolveDraftOpenClawModelRef(null, 'openai/gpt-5.2')).toBe('');
  });
});

describe('resolveOpenClawModelSupportMessageKey', () => {
  test('maps reasons to precise i18n keys', () => {
    expect(
      resolveOpenClawModelSupportMessageKey(OpenClawModelSupportReason.LocalModelNotRunning),
    ).toBe('agentLlamaCppModelNotRunningHint');
    expect(
      resolveOpenClawModelSupportMessageKey(
        OpenClawModelSupportReason.LocalModelRuntimeContextUnknown,
      ),
    ).toBe('agentLlamaCppContextUnknownHint');
    expect(
      resolveOpenClawModelSupportMessageKey(
        OpenClawModelSupportReason.LocalModelRuntimeContextTooSmall,
      ),
    ).toBe('agentLlamaCppContextTooSmallHint');
    expect(
      resolveOpenClawModelSupportMessageKey(
        OpenClawModelSupportReason.LocalModelTrainedContextTooSmall,
      ),
    ).toBe('agentLlamaCppTrainedContextTooSmallHint');
  });
});
