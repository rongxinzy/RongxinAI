import { useCallback, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import type { Model } from '../../store/slices/modelSlice';
import { setDefaultSelectedModel, setSelectedModel } from '../../store/slices/modelSlice';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';

export function usePersistAgentModelSelection({
  agentId,
  syncDefaultModel,
}: {
  agentId: string;
  syncDefaultModel: boolean;
}) {
  const dispatch = useDispatch();
  const [isPersistingAgentModel, setIsPersistingAgentModel] = useState(false);
  const requestIdRef = useRef(0);

  const persistAgentModelSelection = useCallback(
    async (model: Model): Promise<boolean> => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setIsPersistingAgentModel(true);

      try {
        const updatedAgent = await agentService.updateAgent(agentId, {
          model: toOpenClawModelRef(model),
        });
        if (requestId !== requestIdRef.current) {
          return false;
        }
        if (!updatedAgent) {
          window.dispatchEvent(
            new CustomEvent('app:showToast', {
              detail: i18nService.t('agentSaveFailed'),
            }),
          );
          return false;
        }

        dispatch(setSelectedModel({ agentId, model }));
        if (syncDefaultModel) {
          dispatch(setDefaultSelectedModel(model));
        }
        return true;
      } finally {
        if (requestId === requestIdRef.current) {
          setIsPersistingAgentModel(false);
        }
      }
    },
    [agentId, dispatch, syncDefaultModel],
  );

  return {
    isPersistingAgentModel,
    persistAgentModelSelection,
  };
}
