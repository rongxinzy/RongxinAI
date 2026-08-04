import { isLocalModelRef } from '@shared/providers';
import type { AgentTriageOverride } from '@shared/triage';

import { LlamaCppOpenClawEligibilityReason } from '../../shared/llamacpp';
import type { Model } from '../store/slices/modelSlice';
import { getModelOpenClawEligibility } from './llamacppOpenClawEligibility';
import { resolveOpenClawModelRef, toOpenClawModelRef } from './openclawModelRef';

export const OpenClawModelSupportReason = {
  Supported: 'supported',
  LocalModelNotRunning: 'local_model_not_running',
  LocalModelRuntimeContextUnknown: 'local_model_runtime_context_unknown',
  LocalModelRuntimeContextTooSmall: 'local_model_runtime_context_too_small',
  LocalModelTrainedContextTooSmall: 'local_model_trained_context_too_small',
} as const;

export type OpenClawModelSupportReason =
  (typeof OpenClawModelSupportReason)[keyof typeof OpenClawModelSupportReason];

export const OpenClawModelValidationTargetKind = {
  Primary: 'primary',
  TriageLight: 'triage_light',
  TriageHeavy: 'triage_heavy',
} as const;

export type OpenClawModelValidationTargetKind =
  (typeof OpenClawModelValidationTargetKind)[keyof typeof OpenClawModelValidationTargetKind];

export type OpenClawModelValidationTarget = {
  kind: OpenClawModelValidationTargetKind;
  modelRef: string;
};

export type OpenClawModelSupportResult = {
  reason: OpenClawModelSupportReason;
  modelRef: string;
};

export type OpenClawModelValidationFailure = OpenClawModelSupportResult & {
  targetKind: OpenClawModelValidationTargetKind;
};

function normalizeModelRef(modelRef?: string | null): string {
  return modelRef?.trim() ?? '';
}

export function resolveDraftOpenClawModelRef(model: Model | null, preservedModelRef = ''): string {
  if (model?.providerKey) {
    return toOpenClawModelRef(model);
  }
  if (model) {
    return normalizeModelRef(preservedModelRef);
  }
  return '';
}

export function resolveOpenClawModelSupportResult(
  modelRef: string,
  availableModels: Model[],
): OpenClawModelSupportResult {
  const normalizedModelRef = normalizeModelRef(modelRef);
  if (!normalizedModelRef) {
    return {
      reason: OpenClawModelSupportReason.Supported,
      modelRef: '',
    };
  }

  const resolvedModel = resolveOpenClawModelRef(normalizedModelRef, availableModels);
  if (resolvedModel) {
    const eligibility = getModelOpenClawEligibility(resolvedModel);
    if (!eligibility || eligibility.eligible) {
      return {
        reason: OpenClawModelSupportReason.Supported,
        modelRef: normalizedModelRef,
      };
    }

    switch (eligibility.reason) {
      case LlamaCppOpenClawEligibilityReason.RuntimeContextUnknown:
        return {
          reason: OpenClawModelSupportReason.LocalModelRuntimeContextUnknown,
          modelRef: normalizedModelRef,
        };
      case LlamaCppOpenClawEligibilityReason.RuntimeContextTooSmall:
        return {
          reason: OpenClawModelSupportReason.LocalModelRuntimeContextTooSmall,
          modelRef: normalizedModelRef,
        };
      case LlamaCppOpenClawEligibilityReason.TrainedContextTooSmall:
        return {
          reason: OpenClawModelSupportReason.LocalModelTrainedContextTooSmall,
          modelRef: normalizedModelRef,
        };
      case LlamaCppOpenClawEligibilityReason.Eligible:
      default:
        return {
          reason: OpenClawModelSupportReason.Supported,
          modelRef: normalizedModelRef,
        };
    }
  }

  if (isLocalModelRef(normalizedModelRef)) {
    return {
      reason: OpenClawModelSupportReason.LocalModelNotRunning,
      modelRef: normalizedModelRef,
    };
  }

  return {
    reason: OpenClawModelSupportReason.Supported,
    modelRef: normalizedModelRef,
  };
}

export function resolveOpenClawModelSupport(
  modelRef: string,
  availableModels: Model[],
): OpenClawModelSupportReason {
  return resolveOpenClawModelSupportResult(modelRef, availableModels).reason;
}

export function buildOpenClawModelValidationTargets(input: {
  primaryModelRef?: string | null;
  fallbackModelRef?: string | null;
  triageOverride?: AgentTriageOverride | null;
}): OpenClawModelValidationTarget[] {
  const targets: OpenClawModelValidationTarget[] = [];
  const primaryModelRef =
    normalizeModelRef(input.primaryModelRef) || normalizeModelRef(input.fallbackModelRef);

  const pushTarget = (kind: OpenClawModelValidationTargetKind, modelRef: string): void => {
    if (!modelRef) return;
    if (targets.some(target => target.modelRef === modelRef)) {
      return;
    }
    targets.push({ kind, modelRef });
  };

  pushTarget(OpenClawModelValidationTargetKind.Primary, primaryModelRef);

  if (!input.triageOverride?.enabled) {
    return targets;
  }

  pushTarget(
    OpenClawModelValidationTargetKind.TriageLight,
    normalizeModelRef(input.triageOverride.lightModelRef),
  );
  pushTarget(
    OpenClawModelValidationTargetKind.TriageHeavy,
    normalizeModelRef(input.triageOverride.heavyModelRef),
  );

  return targets;
}

export function resolveFirstUnsupportedOpenClawModel(
  targets: OpenClawModelValidationTarget[],
  availableModels: Model[],
): OpenClawModelValidationFailure | null {
  for (const target of targets) {
    const result = resolveOpenClawModelSupportResult(target.modelRef, availableModels);
    if (result.reason !== OpenClawModelSupportReason.Supported) {
      return {
        ...result,
        targetKind: target.kind,
      };
    }
  }

  return null;
}

export function resolveOpenClawModelSupportMessageKey(reason: OpenClawModelSupportReason): string {
  switch (reason) {
    case OpenClawModelSupportReason.LocalModelNotRunning:
      return 'agentLlamaCppModelNotRunningHint';
    case OpenClawModelSupportReason.LocalModelRuntimeContextUnknown:
      return 'agentLlamaCppContextUnknownHint';
    case OpenClawModelSupportReason.LocalModelRuntimeContextTooSmall:
      return 'agentLlamaCppContextTooSmallHint';
    case OpenClawModelSupportReason.LocalModelTrainedContextTooSmall:
      return 'agentLlamaCppTrainedContextTooSmallHint';
    case OpenClawModelSupportReason.Supported:
    default:
      return '';
  }
}
