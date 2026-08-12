import { isLocalModelRef } from '@shared/providers';
import type { AgentTriageOverride } from '@shared/triage';

import { LlamaCppAgentEligibilityReason } from '../../shared/llamacpp';
import type { Model } from '../store/slices/modelSlice';
import { getModelAgentEligibility } from './llamacppAgentEligibility';
import { resolveAgentModelRef, toAgentModelRef } from './agentModelRef';

export const AgentModelSupportReason = {
  Supported: 'supported',
  LocalModelNotRunning: 'local_model_not_running',
  LocalModelRuntimeContextUnknown: 'local_model_runtime_context_unknown',
  LocalModelRuntimeContextTooSmall: 'local_model_runtime_context_too_small',
  LocalModelTrainedContextTooSmall: 'local_model_trained_context_too_small',
} as const;

export type AgentModelSupportReason =
  (typeof AgentModelSupportReason)[keyof typeof AgentModelSupportReason];

export const AgentModelValidationTargetKind = {
  Primary: 'primary',
  TriageLight: 'triage_light',
  TriageHeavy: 'triage_heavy',
} as const;

export type AgentModelValidationTargetKind =
  (typeof AgentModelValidationTargetKind)[keyof typeof AgentModelValidationTargetKind];

export type AgentModelValidationTarget = {
  kind: AgentModelValidationTargetKind;
  modelRef: string;
};

export type AgentModelSupportResult = {
  reason: AgentModelSupportReason;
  modelRef: string;
};

export type AgentModelValidationFailure = AgentModelSupportResult & {
  targetKind: AgentModelValidationTargetKind;
};

function normalizeModelRef(modelRef?: string | null): string {
  return modelRef?.trim() ?? '';
}

export function resolveDraftAgentModelRef(model: Model | null, preservedModelRef = ''): string {
  if (model?.providerKey) {
    return toAgentModelRef(model);
  }
  if (model) {
    return normalizeModelRef(preservedModelRef);
  }
  return '';
}

export function resolveAgentModelSupportResult(
  modelRef: string,
  availableModels: Model[],
): AgentModelSupportResult {
  const normalizedModelRef = normalizeModelRef(modelRef);
  if (!normalizedModelRef) {
    return {
      reason: AgentModelSupportReason.Supported,
      modelRef: '',
    };
  }

  const resolvedModel = resolveAgentModelRef(normalizedModelRef, availableModels);
  if (resolvedModel) {
    const eligibility = getModelAgentEligibility(resolvedModel);
    if (!eligibility || eligibility.eligible) {
      return {
        reason: AgentModelSupportReason.Supported,
        modelRef: normalizedModelRef,
      };
    }

    switch (eligibility.reason) {
      case LlamaCppAgentEligibilityReason.RuntimeContextUnknown:
        return {
          reason: AgentModelSupportReason.LocalModelRuntimeContextUnknown,
          modelRef: normalizedModelRef,
        };
      case LlamaCppAgentEligibilityReason.RuntimeContextTooSmall:
        return {
          reason: AgentModelSupportReason.LocalModelRuntimeContextTooSmall,
          modelRef: normalizedModelRef,
        };
      case LlamaCppAgentEligibilityReason.TrainedContextTooSmall:
        return {
          reason: AgentModelSupportReason.LocalModelTrainedContextTooSmall,
          modelRef: normalizedModelRef,
        };
      case LlamaCppAgentEligibilityReason.Eligible:
      default:
        return {
          reason: AgentModelSupportReason.Supported,
          modelRef: normalizedModelRef,
        };
    }
  }

  if (isLocalModelRef(normalizedModelRef)) {
    return {
      reason: AgentModelSupportReason.LocalModelNotRunning,
      modelRef: normalizedModelRef,
    };
  }

  return {
    reason: AgentModelSupportReason.Supported,
    modelRef: normalizedModelRef,
  };
}

export function resolveAgentModelSupport(
  modelRef: string,
  availableModels: Model[],
): AgentModelSupportReason {
  return resolveAgentModelSupportResult(modelRef, availableModels).reason;
}

export function buildAgentModelValidationTargets(input: {
  primaryModelRef?: string | null;
  fallbackModelRef?: string | null;
  triageOverride?: AgentTriageOverride | null;
}): AgentModelValidationTarget[] {
  const targets: AgentModelValidationTarget[] = [];
  const primaryModelRef =
    normalizeModelRef(input.primaryModelRef) || normalizeModelRef(input.fallbackModelRef);

  const pushTarget = (kind: AgentModelValidationTargetKind, modelRef: string): void => {
    if (!modelRef) return;
    if (targets.some(target => target.modelRef === modelRef)) {
      return;
    }
    targets.push({ kind, modelRef });
  };

  pushTarget(AgentModelValidationTargetKind.Primary, primaryModelRef);

  if (!input.triageOverride?.enabled) {
    return targets;
  }

  pushTarget(
    AgentModelValidationTargetKind.TriageLight,
    normalizeModelRef(input.triageOverride.lightModelRef),
  );
  pushTarget(
    AgentModelValidationTargetKind.TriageHeavy,
    normalizeModelRef(input.triageOverride.heavyModelRef),
  );

  return targets;
}

export function resolveFirstUnsupportedAgentModel(
  targets: AgentModelValidationTarget[],
  availableModels: Model[],
): AgentModelValidationFailure | null {
  for (const target of targets) {
    const result = resolveAgentModelSupportResult(target.modelRef, availableModels);
    if (result.reason !== AgentModelSupportReason.Supported) {
      return {
        ...result,
        targetKind: target.kind,
      };
    }
  }

  return null;
}

export function resolveAgentModelSupportMessageKey(reason: AgentModelSupportReason): string {
  switch (reason) {
    case AgentModelSupportReason.LocalModelNotRunning:
      return 'agentLlamaCppModelNotRunningHint';
    case AgentModelSupportReason.LocalModelRuntimeContextUnknown:
      return 'agentLlamaCppContextUnknownHint';
    case AgentModelSupportReason.LocalModelRuntimeContextTooSmall:
      return 'agentLlamaCppContextTooSmallHint';
    case AgentModelSupportReason.LocalModelTrainedContextTooSmall:
      return 'agentLlamaCppTrainedContextTooSmallHint';
    case AgentModelSupportReason.Supported:
    default:
      return '';
  }
}
