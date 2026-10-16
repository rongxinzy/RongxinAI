import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type {
  LlamaCppModel as OllamaModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelPreferences,
  LlamaCppRunningModel as OllamaRunningModel,
} from '../../../../shared/llamacpp';
import { notifyLlamaCppRunningModelsChanged } from '../../../services/availableModels';
import {
  LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS,
} from '../constants';
import {
  LocalInferenceToastKind,
  type LocalInferenceToastKind as LocalInferenceToastKindType,
} from '../types';
import { getRemainingBusyMs, shouldBlockModelAction } from '../utils/modelActions';

type UseLocalModelActionsInput = {
  runAction: (action: () => Promise<void>) => Promise<void>;
  showToast: (message: string, kind?: LocalInferenceToastKindType) => void;
  setRunningModels: Dispatch<SetStateAction<OllamaRunningModel[]>>;
  refreshRunningModels: () => Promise<OllamaRunningModel[]>;
  refreshLocalModels: () => Promise<OllamaModel[]>;
  refreshModelPreferences: () => Promise<LlamaCppModelPreferences>;
  markMarketplaceUninstalled: (modelName: string) => void;
};

type UseLocalModelActionsResult = {
  loadingModelName: string | null;
  cancellingModelLoad: boolean;
  unloadingModelName: string | null;
  startedModelName: string | null;
  setStartedModelName: Dispatch<SetStateAction<string | null>>;
  handleLoadModel: (model: OllamaModel) => void;
  handleCancelModelLoad: () => void;
  handleUnload: (modelName: string) => void;
  handleDelete: (modelName: string) => void;
};

/**
 * Owns local model lifecycle actions: load (with cancellation), unload (with a
 * minimum busy duration and settle polling) and delete, plus their busy
 * indicators surfaced by the models panel.
 */
export function useLocalModelActions(input: UseLocalModelActionsInput): UseLocalModelActionsResult {
  const {
    runAction,
    showToast,
    setRunningModels,
    refreshRunningModels,
    refreshLocalModels,
    refreshModelPreferences,
    markMarketplaceUninstalled,
  } = input;
  const [loadingModelName, setLoadingModelName] = useState<string | null>(null);
  const [cancellingModelLoad, setCancellingModelLoad] = useState(false);
  const cancelledModelLoadRef = useRef(false);
  const [unloadingModelName, setUnloadingModelName] = useState<string | null>(null);
  const [startedModelName, setStartedModelName] = useState<string | null>(null);
  const loadingModelNameRef = useRef<string | null>(null);

  const waitForUnloadSettle = useCallback(
    async (modelName: string) => {
      const deadline = Date.now() + LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS;
      let latestModels = await refreshRunningModels();
      while (
        latestModels.some(model => model.name === modelName || model.model === modelName) &&
        Date.now() < deadline
      ) {
        await new Promise<void>(resolve => {
          window.setTimeout(resolve, LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS);
        });
        latestModels = await refreshRunningModels();
      }
      return latestModels;
    },
    [refreshRunningModels],
  );

  const handleLoadModel = useCallback(
    (model: OllamaModel) => {
      const modelName = model.name;
      if (loadingModelNameRef.current) return;
      loadingModelNameRef.current = modelName;
      cancelledModelLoadRef.current = false;
      setLoadingModelName(modelName);
      void runAction(async () => {
        try {
          const launchInput: LlamaCppModelLaunchInput = {
            model: modelName,
            ...(model.path ? { modelPath: model.path } : {}),
          };
          const result = await window.electron.llamacpp.loadModel(launchInput);
          setRunningModels(result.runningModels);
          notifyLlamaCppRunningModelsChanged();
          // Only direct user launches prompt for configuration; background restoration remains silent.
          setStartedModelName(modelName);
          if (result.warning) {
            showToast(result.warning, LocalInferenceToastKind.Info);
          }
        } catch (loadError) {
          if (cancelledModelLoadRef.current) {
            await refreshRunningModels();
            notifyLlamaCppRunningModelsChanged();
            return;
          }
          throw loadError;
        } finally {
          loadingModelNameRef.current = null;
          setLoadingModelName(current => (current === modelName ? null : current));
          setCancellingModelLoad(false);
          cancelledModelLoadRef.current = false;
        }
      });
    },
    [refreshRunningModels, runAction, setRunningModels, showToast],
  );

  const handleCancelModelLoad = useCallback(() => {
    const modelName = loadingModelNameRef.current;
    if (!modelName || cancellingModelLoad) return;
    cancelledModelLoadRef.current = true;
    setCancellingModelLoad(true);
    void runAction(async () => {
      try {
        const result = await window.electron.llamacpp.cancelModelLoad(modelName);
        if (!result.cancelled) {
          cancelledModelLoadRef.current = false;
          setCancellingModelLoad(false);
          return;
        }
      } catch (error) {
        cancelledModelLoadRef.current = false;
        setCancellingModelLoad(false);
        throw error;
      }
    });
  }, [cancellingModelLoad, runAction]);

  const handleUnload = useCallback(
    (modelName: string) => {
      if (shouldBlockModelAction({ modelName, unloadingModelName })) return;
      const unloadStartedAtMs = Date.now();
      setUnloadingModelName(modelName);
      void runAction(async () => {
        try {
          const result = await window.electron.llamacpp.unloadModel(modelName);
          let latestRunningModels = result.runningModels;
          setRunningModels(latestRunningModels);
          if (!result.confirmed) {
            latestRunningModels = await waitForUnloadSettle(modelName);
          }
          notifyLlamaCppRunningModelsChanged();
          if (result.warning) {
            const stillVisible = latestRunningModels.some(
              model => model.name === modelName || model.model === modelName,
            );
            if (result.confirmed || stillVisible) {
              showToast(result.warning, LocalInferenceToastKind.Info);
            }
          }
        } finally {
          const remainingBusyMs = getRemainingBusyMs({
            startedAtMs: unloadStartedAtMs,
            nowMs: Date.now(),
            minimumBusyMs: LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS,
          });
          if (remainingBusyMs > 0) {
            await new Promise<void>(resolve => {
              window.setTimeout(resolve, remainingBusyMs);
            });
          }
          setUnloadingModelName(current => (current === modelName ? null : current));
        }
      });
    },
    [runAction, setRunningModels, showToast, unloadingModelName, waitForUnloadSettle],
  );

  const handleDelete = useCallback(
    (modelName: string) => {
      if (shouldBlockModelAction({ modelName, unloadingModelName })) return;
      void runAction(async () => {
        await window.electron.llamacpp.deleteModel(modelName);
        await refreshLocalModels();
        await refreshRunningModels();
        await refreshModelPreferences();
        markMarketplaceUninstalled(modelName);
        notifyLlamaCppRunningModelsChanged();
      });
    },
    [
      markMarketplaceUninstalled,
      refreshLocalModels,
      refreshModelPreferences,
      refreshRunningModels,
      runAction,
      unloadingModelName,
    ],
  );

  return {
    loadingModelName,
    cancellingModelLoad,
    unloadingModelName,
    startedModelName,
    setStartedModelName,
    handleLoadModel,
    handleCancelModelLoad,
    handleUnload,
    handleDelete,
  };
}
