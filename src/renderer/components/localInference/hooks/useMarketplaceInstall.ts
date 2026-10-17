import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type {
  LlamaCppInstallProgress,
  LlamaCppModel as OllamaModel,
} from '../../../../shared/llamacpp';
import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import { LOCAL_INFERENCE_PROGRESS_DISMISS_MS } from '../constants';
import {
  LocalInferenceToastKind,
  type LocalInferenceToastKind as LocalInferenceToastKindType,
  type InstallProgressState,
} from '../types';
import { getLocalInferenceUserFacingErrorMessage } from '../utils/errors';
import { groupMarketplaceVariants } from '../utils/marketplace';
import { isPullInProgress } from '../utils/progress';

type UseMarketplaceInstallInput = {
  showToast: (message: string, kind?: LocalInferenceToastKindType) => void;
  refreshLocalModels: () => Promise<OllamaModel[]>;
  markMarketplaceInstalled: (name: string) => void;
};

type UseMarketplaceInstallResult = {
  /** True while a marketplace install is requested or bytes are still moving. */
  pulling: boolean;
  activePullName: string | null;
  setPullProgress: Dispatch<SetStateAction<InstallProgressState>>;
  clearInstallProgressDismissTimer: (name: string) => void;
  scheduleInstallProgressDismiss: (name: string, phase: LlamaCppInstallProgress['phase']) => void;
  handleMarketplaceInstall: (model: MarketplaceModel) => Promise<void>;
  openMarketplaceDownloadPanel: () => void;
  marketplaceDownloadModel: MarketplaceModel | null;
  marketplaceDownloadPanelProgress: LlamaCppInstallProgress | undefined;
  marketplaceDownloadPanelVisible: boolean;
  setMarketplaceDownloadPanelVisible: (visible: boolean) => void;
};

/**
 * Owns the marketplace model install flow: pull progress tracking with
 * auto-dismissing terminal notices, the download side panel state, and the
 * install request itself (variant files, mmproj, split-GGUF parts).
 */
export function useMarketplaceInstall(
  input: UseMarketplaceInstallInput,
): UseMarketplaceInstallResult {
  const { showToast, refreshLocalModels, markMarketplaceInstalled } = input;
  const [activePullName, setActivePullName] = useState<string | null>(null);
  const [isMarketplaceInstallPending, setIsMarketplaceInstallPending] = useState(false);
  const [pullProgress, setPullProgress] = useState<InstallProgressState>({});
  const [marketplaceDownloadModel, setMarketplaceDownloadModel] = useState<MarketplaceModel | null>(
    null,
  );
  const [marketplaceDownloadPanelProgress, setMarketplaceDownloadPanelProgress] =
    useState<LlamaCppInstallProgress>();
  const [marketplaceDownloadPanelVisible, setMarketplaceDownloadPanelVisible] = useState(false);
  const installProgressDismissTimersRef = useRef<Record<string, number>>({});
  const activePullProgress = activePullName ? pullProgress[activePullName] : undefined;
  const pulling = isMarketplaceInstallPending || isPullInProgress(activePullProgress);

  const openMarketplaceDownloadPanel = useCallback(() => {
    setMarketplaceDownloadPanelVisible(true);
  }, []);

  useEffect(() => {
    if (activePullProgress) setMarketplaceDownloadPanelProgress(activePullProgress);
  }, [activePullProgress]);

  const clearInstallProgressDismissTimer = useCallback((name: string) => {
    const timer = installProgressDismissTimersRef.current[name];
    if (!timer) return;
    window.clearTimeout(timer);
    delete installProgressDismissTimersRef.current[name];
  }, []);

  const scheduleInstallProgressDismiss = useCallback(
    (name: string, phase: LlamaCppInstallProgress['phase']) => {
      clearInstallProgressDismissTimer(name);
      installProgressDismissTimersRef.current[name] = window.setTimeout(() => {
        setPullProgress(current => {
          if (current[name]?.phase !== phase) return current;
          const { [name]: _completedProgress, ...nextProgress } = current;
          return nextProgress;
        });
        delete installProgressDismissTimersRef.current[name];
      }, LOCAL_INFERENCE_PROGRESS_DISMISS_MS);
    },
    [clearInstallProgressDismissTimer],
  );

  const handleMarketplaceInstall = useCallback(
    async (model: MarketplaceModel) => {
      if (pulling) {
        openMarketplaceDownloadPanel();
        showToast(
          i18nService.t('marketplaceInstallAlreadyInProgress'),
          LocalInferenceToastKind.Info,
        );
        return;
      }
      const name = model.repoId;
      setMarketplaceDownloadModel(model);
      setMarketplaceDownloadPanelProgress(undefined);
      openMarketplaceDownloadPanel();
      clearInstallProgressDismissTimer(name);
      setActivePullName(name);
      setIsMarketplaceInstallPending(true);
      try {
        const selectedFile =
          model.files?.find(file => file.path === model.filePath) ??
          model.files?.find(file => file.isRecommended);
        const mmprojFile = model.files?.find(file => file.path === model.mmprojFilePath);
        // Split-GGUF variants: the card pins filePath to the first part; the
        // remaining sibling parts must travel with the install request because
        // prefill short-circuits when downloadUrl+sha256 are already present.
        const selectedVariant =
          groupMarketplaceVariants(model.files).find(variant =>
            variant.files.some(file => file.path === model.filePath),
          ) ?? groupMarketplaceVariants(model.files)[0];
        const extraFiles = (selectedVariant?.files ?? [])
          .filter(file => file.path !== selectedFile?.path)
          .map(file => ({
            path: file.path,
            downloadUrl: file.downloadUrl,
            revision: file.revision,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
          }));
        const result = await window.electron.llamacpp.installModel({
          modelId: model.repoId,
          filePath: selectedFile?.path,
          displayName: model.repoId,
          downloadUrl: selectedFile?.downloadUrl,
          revision: selectedFile?.revision ?? model.runtime?.revision,
          sha256: selectedFile?.sha256,
          fileSizeBytes: selectedFile?.sizeBytes,
          extraFiles,
          mmprojFilePath: mmprojFile?.path,
          mmprojDownloadUrl: mmprojFile?.downloadUrl,
          mmprojSha256: mmprojFile?.sha256,
        });
        if (!result.success) return;
        await refreshLocalModels();
        markMarketplaceInstalled(name);
        showToast(
          i18nService.t('marketplacePullDone').replace('{name}', name),
          LocalInferenceToastKind.Success,
        );
      } catch (installError) {
        showToast(
          getLocalInferenceUserFacingErrorMessage(installError),
          LocalInferenceToastKind.Error,
        );
      } finally {
        setIsMarketplaceInstallPending(false);
      }
    },
    [
      clearInstallProgressDismissTimer,
      markMarketplaceInstalled,
      openMarketplaceDownloadPanel,
      pulling,
      refreshLocalModels,
      showToast,
    ],
  );

  useEffect(() => {
    return () => {
      Object.values(installProgressDismissTimersRef.current).forEach(timer => {
        window.clearTimeout(timer);
      });
      installProgressDismissTimersRef.current = {};
    };
  }, []);

  return {
    pulling,
    activePullName,
    setPullProgress,
    clearInstallProgressDismissTimer,
    scheduleInstallProgressDismiss,
    handleMarketplaceInstall,
    openMarketplaceDownloadPanel,
    marketplaceDownloadModel,
    marketplaceDownloadPanelProgress,
    marketplaceDownloadPanelVisible,
    setMarketplaceDownloadPanelVisible,
  };
}
