import { useCallback, useState } from 'react';

import type {
  LlamaCppModelPreferences,
  LlamaCppRunningModel as OllamaRunningModel,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import {
  LocalInferenceToastKind,
  type LocalInferenceToastKind as LocalInferenceToastKindType,
} from '../types';
import { getLocalInferenceUserFacingErrorMessage } from '../utils/errors';

type ModelPreferenceInput = {
  ctxSize?: number;
  residency?: NonNullable<LlamaCppModelPreferences[string]['residency']>;
};

type UseModelPreferencesInput = {
  runningModels: OllamaRunningModel[];
  setLoading: (loading: boolean) => void;
  showToast: (message: string, kind?: LocalInferenceToastKindType) => void;
};

type UseModelPreferencesResult = {
  modelPreferences: LlamaCppModelPreferences;
  refreshModelPreferences: () => Promise<LlamaCppModelPreferences>;
  saveModelPreferences: (modelName: string, input: ModelPreferenceInput) => Promise<boolean>;
};

/**
 * Owns per-model runtime preferences (context size, residency). Saving applies
 * the change optimistically and rolls back if the main process rejects it.
 */
export function useModelPreferences(input: UseModelPreferencesInput): UseModelPreferencesResult {
  const { runningModels, setLoading, showToast } = input;
  const [modelPreferences, setModelPreferences] = useState<LlamaCppModelPreferences>({});

  const refreshModelPreferences = useCallback(async () => {
    const nextPreferences = await window.electron.llamacpp.getModelPreferences();
    setModelPreferences(nextPreferences);
    return nextPreferences;
  }, []);

  const saveModelPreferences = useCallback(
    async (modelName: string, input: ModelPreferenceInput): Promise<boolean> => {
      const previousPreference = modelPreferences[modelName];
      const nextPreference = {
        ...previousPreference,
        ...(input.ctxSize !== undefined ? { ctxSize: input.ctxSize } : {}),
        ...(input.residency ? { residency: input.residency } : {}),
      };
      setModelPreferences(current => ({
        ...current,
        [modelName]: nextPreference,
      }));
      setLoading(true);
      try {
        const nextPreferences = await window.electron.llamacpp.setModelPreference({
          modelName,
          preference: nextPreference,
        });
        setModelPreferences(nextPreferences);
        const runningModel = runningModels.find(
          model => model.name === modelName || model.model === modelName,
        );
        showToast(
          input.ctxSize !== undefined && input.ctxSize !== previousPreference?.ctxSize
            ? runningModel
              ? i18nService.t('localInferenceContextSavedReloadRequired')
              : i18nService.t('localInferenceContextSaved')
            : i18nService.t('localInferenceResidencySaved'),
          LocalInferenceToastKind.Success,
        );
        return true;
      } catch (error) {
        setModelPreferences(current => {
          const { [modelName]: _discarded, ...remaining } = current;
          return previousPreference ? { ...remaining, [modelName]: previousPreference } : remaining;
        });
        showToast(getLocalInferenceUserFacingErrorMessage(error), LocalInferenceToastKind.Error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [modelPreferences, runningModels, setLoading, showToast],
  );

  return {
    modelPreferences,
    refreshModelPreferences,
    saveModelPreferences,
  };
}
