import { useMemo } from 'react';
import { useSelector } from 'react-redux';

import { OpenClawProviderId } from '../../../shared/providers';
import type { RootState } from '../../store';
import { type Model,selectAgentSelectedModel } from '../../store/slices/modelSlice';
import type { CoworkAgentEngine } from '../../types/cowork';
import { isModelSelectableForOpenClaw } from '../../utils/llamacppOpenClawEligibility';
import { resolveOpenClawModelRef } from '../../utils/openclawModelRef';

type ResolveAgentModelSelectionInput = {
  sessionModel?: string;
  agentModel: string;
  availableModels: Model[];
  fallbackModel: Model | null;
  engine: CoworkAgentEngine;
};

type ResolveAgentModelSelectionResult = {
  selectedModel: Model | null;
  usesFallback: boolean;
  hasInvalidExplicitModel: boolean;
  invalidExplicitModelRef: string | null;
  hasUnavailableLlamaCppModel: boolean;
  hasIneligibleLlamaCppModel: boolean;
};

export function isLlamaCppModelRef(modelRef: string): boolean {
  return modelRef.trim().startsWith(`${OpenClawProviderId.LlamaCpp}/`);
}

/**
 * Determine which Model object the prompt input should use for capability
 * checks (e.g. supportsImage).
 *
 * On the **home page** (no sessionId) the selectors use the current agent's
 * resolved model. Callers persist user changes to the agent model before
 * passing that value back here, so image capability checks must honour it.
 *
 * Inside a **session** (has sessionId) the agent-level resolution
 * (session override → agent model → fallback) is authoritative.
 */
export function resolveEffectiveModel({
  sessionId,
  agentSelectedModel,
  globalSelectedModel,
}: {
  sessionId: string | undefined;
  agentSelectedModel: Model | null;
  globalSelectedModel: Model | null;
}): Model | null {
  return sessionId ? agentSelectedModel : globalSelectedModel;
}

export function resolveAgentModelSelection({
  sessionModel,
  agentModel,
  availableModels,
  fallbackModel,
}: ResolveAgentModelSelectionInput): ResolveAgentModelSelectionResult {
  const normalizedSessionModel = sessionModel?.trim() ?? '';
  if (normalizedSessionModel) {
    const explicitSessionModel = resolveOpenClawModelRef(normalizedSessionModel, availableModels) ?? null;
    if (explicitSessionModel) {
      return {
        selectedModel: explicitSessionModel,
        usesFallback: false,
        hasInvalidExplicitModel: false,
        invalidExplicitModelRef: null,
        hasUnavailableLlamaCppModel: false,
        hasIneligibleLlamaCppModel: !isModelSelectableForOpenClaw(explicitSessionModel),
      };
    }

    return {
      selectedModel: fallbackModel,
      usesFallback: true,
      hasInvalidExplicitModel: true,
      invalidExplicitModelRef: normalizedSessionModel,
      hasUnavailableLlamaCppModel: isLlamaCppModelRef(normalizedSessionModel),
      hasIneligibleLlamaCppModel: false,
    };
  }

  const normalizedAgentModel = agentModel.trim();
  if (normalizedAgentModel) {
    const explicitModel = resolveOpenClawModelRef(normalizedAgentModel, availableModels) ?? null;
    if (explicitModel) {
      return {
        selectedModel: explicitModel,
        usesFallback: false,
        hasInvalidExplicitModel: false,
        invalidExplicitModelRef: null,
        hasUnavailableLlamaCppModel: false,
        hasIneligibleLlamaCppModel: !isModelSelectableForOpenClaw(explicitModel),
      };
    }

    return {
      selectedModel: fallbackModel,
      usesFallback: true,
      hasInvalidExplicitModel: false,
      invalidExplicitModelRef: normalizedAgentModel,
      hasUnavailableLlamaCppModel: isLlamaCppModelRef(normalizedAgentModel),
      hasIneligibleLlamaCppModel: false,
    };
  }

  return {
    selectedModel: fallbackModel,
    usesFallback: true,
    hasInvalidExplicitModel: false,
    invalidExplicitModelRef: null,
    hasUnavailableLlamaCppModel: false,
    hasIneligibleLlamaCppModel: false,
  };
}

/**
 * Hook: resolve the effective selected model for a given agent.
 *
 * Shared by CoworkView (header) and CoworkPromptInput (prompt area) to avoid
 * duplicating the per-agent model resolution logic.
 */
export function useAgentSelectedModel(agentId: string, agentModelRef: string): Model {
  const modelState = useSelector((state: RootState) => state.model);
  return useMemo(
    () => selectAgentSelectedModel(modelState, agentId, agentModelRef),
    [modelState, agentId, agentModelRef],
  );
}
