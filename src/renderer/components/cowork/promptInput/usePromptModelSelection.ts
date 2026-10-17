import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import { agentService } from '../../../services/agent';
import { coworkService } from '../../../services/cowork';
import { i18nService } from '../../../services/i18n';
import { updateCurrentSessionModelOverride } from '../../../store/slices/coworkSlice';
import { type Model, setSelectedModel } from '../../../store/slices/modelSlice';
import type { CoworkSession } from '../../../types/cowork';
import { toAgentModelRef } from '../../../utils/agentModelRef';
import {
  resolveAgentModelSelection,
  resolveEffectiveModel,
  useAgentSelectedModel,
} from '../agentModelSelection';
import { usePersistAgentModelSelection } from '../usePersistAgentModelSelection';

/** Structural slice of the agent summary the prompt input's model logic needs. */
interface PromptInputAgent {
  id: string;
  model: string;
  isDefault?: boolean;
}

interface UsePromptModelSelectionParams {
  sessionId?: string;
  currentAgentId: string;
  currentAgent?: PromptInputAgent;
  currentSession: CoworkSession | null;
  availableModels: Model[];
}

/**
 * Model resolution and switching for the composer: resolves the effective
 * model (session override → agent model → fallback), keeps the agent
 * selection aligned with in-session model changes, and patches the session
 * override through the cowork service.
 */
export function usePromptModelSelection({
  sessionId,
  currentAgentId,
  currentAgent,
  currentSession,
  availableModels,
}: UsePromptModelSelectionParams) {
  const dispatch = useDispatch();
  const [isPatchingModel, setIsPatchingModel] = useState(false);
  const modelPatchRequestIdRef = useRef(0);

  const currentAgentSelectedModel = useAgentSelectedModel(
    currentAgentId,
    currentAgent?.model ?? '',
  );
  const { isPersistingAgentModel, persistAgentModelSelection } = usePersistAgentModelSelection({
    agentId: currentAgentId,
    syncDefaultModel: currentAgentId === 'main' || currentAgent?.isDefault === true,
  });

  const {
    selectedModel: agentSelectedModel,
    hasInvalidExplicitModel: agentModelIsInvalid,
    hasUnavailableLlamaCppModel,
  } = resolveAgentModelSelection({
    sessionModel:
      currentSession && currentSession.id === sessionId ? currentSession.modelOverride : '',
    agentModel: currentAgent?.model ?? '',
    availableModels,
    fallbackModel: currentAgentSelectedModel,
  });

  const handleModelSelect = useCallback(
    async (nextModel: Model) => {
      if (isPatchingModel || isPersistingAgentModel) return;
      const modelRef = toAgentModelRef(nextModel);
      // Keep the agent selection aligned with model changes inside a session.
      dispatch(setSelectedModel({ agentId: currentAgentId, model: nextModel }));
      if (sessionId) {
        const reqId = modelPatchRequestIdRef.current + 1;
        modelPatchRequestIdRef.current = reqId;
        const prev = currentSession?.id === sessionId ? currentSession.modelOverride : '';
        setIsPatchingModel(true);
        dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: modelRef }));
        try {
          const ok = await coworkService.updateSessionModel(sessionId, modelRef);
          if (reqId !== modelPatchRequestIdRef.current) return;
          if (!ok) {
            dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: prev }));
            window.dispatchEvent(
              new CustomEvent('app:showToast', {
                detail: i18nService.t('coworkModelSwitchFailed'),
              }),
            );
          } else if (currentAgent && agentModelIsInvalid) {
            void agentService.updateAgent(currentAgent.id, { model: modelRef });
          }
        } catch {
          if (reqId === modelPatchRequestIdRef.current)
            dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: prev }));
        } finally {
          if (reqId === modelPatchRequestIdRef.current) setIsPatchingModel(false);
        }
        return;
      }
      await persistAgentModelSelection(nextModel);
    },
    [
      isPatchingModel,
      isPersistingAgentModel,
      sessionId,
      currentSession,
      currentAgentId,
      dispatch,
      currentAgent,
      agentModelIsInvalid,
      persistAgentModelSelection,
    ],
  );

  useEffect(() => {
    modelPatchRequestIdRef.current += 1;
    setIsPatchingModel(false);
  }, [sessionId]);

  const effectiveSelectedModel = resolveEffectiveModel({
    sessionId,
    agentSelectedModel,
    globalSelectedModel: currentAgentSelectedModel,
  });
  const modelSupportsImage = !!effectiveSelectedModel?.supportsImage;

  return {
    effectiveSelectedModel,
    modelSupportsImage,
    isPatchingModel,
    hasUnavailableLlamaCppModel,
    handleModelSelect,
  };
}
