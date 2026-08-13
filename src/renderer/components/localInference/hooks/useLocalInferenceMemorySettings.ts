import { useCallback, useState } from 'react';

import type { SystemMemorySnapshot } from '../../../../shared/hardware';
import {
  LlamaCppMemoryPolicy,
  type LlamaCppMemoryPolicy as LlamaCppMemoryPolicyType,
  type LlamaCppServiceConfig,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import {
  LocalInferenceToastKind,
  type LocalInferenceToastKind as LocalInferenceToastKindType,
} from '../types';

export const LLAMACPP_MEMORY_BUDGET_PERCENT = {
  Default: 50,
  Min: 10,
  Max: 90,
  Step: 5,
} as const;

type UseLocalInferenceMemorySettingsInput = {
  runAction: (action: () => Promise<void>) => Promise<void>;
  showToast: (message: string, kind?: LocalInferenceToastKindType, autoDismiss?: boolean) => void;
};

type UseLocalInferenceMemorySettingsResult = {
  memorySettingsOpen: boolean;
  draftMemoryPolicy: LlamaCppMemoryPolicyType;
  draftMemoryBudgetPercent: number;
  systemMemorySnapshot: SystemMemorySnapshot | null;
  setDraftMemoryPolicy: (policy: LlamaCppMemoryPolicyType) => void;
  setDraftMemoryBudgetPercent: (percent: number) => void;
  openMemorySettings: () => void;
  closeMemorySettings: () => void;
  saveMemorySettings: () => void;
};

export function useLocalInferenceMemorySettings(
  input: UseLocalInferenceMemorySettingsInput,
): UseLocalInferenceMemorySettingsResult {
  const { runAction, showToast } = input;
  const [memorySettingsOpen, setMemorySettingsOpen] = useState(false);
  const [draftMemoryPolicy, setDraftMemoryPolicy] = useState<LlamaCppMemoryPolicyType>(
    LlamaCppMemoryPolicy.Auto,
  );
  const [draftMemoryBudgetPercent, setDraftMemoryBudgetPercent] = useState<number>(
    LLAMACPP_MEMORY_BUDGET_PERCENT.Default,
  );
  const [systemMemorySnapshot, setSystemMemorySnapshot] = useState<SystemMemorySnapshot | null>(
    null,
  );

  const openMemorySettings = useCallback(() => {
    void Promise.all([
      window.electron.llamacpp.getServiceConfig(),
      window.electron.hardware.systemMemory().catch((): null => null),
    ])
      .then(([config, snapshot]) => {
        setDraftMemoryPolicy(resolveMemoryPolicy(config));
        setDraftMemoryBudgetPercent(resolveMemoryBudgetPercent(config));
        setSystemMemorySnapshot(snapshot);
        setMemorySettingsOpen(true);
      })
      .catch(() => {
        setDraftMemoryPolicy(LlamaCppMemoryPolicy.Auto);
        setDraftMemoryBudgetPercent(LLAMACPP_MEMORY_BUDGET_PERCENT.Default);
        setSystemMemorySnapshot(null);
        setMemorySettingsOpen(true);
      });
  }, []);

  const closeMemorySettings = useCallback(() => {
    setMemorySettingsOpen(false);
  }, []);

  const saveMemorySettings = useCallback(() => {
    void runAction(async () => {
      const previousConfig = await window.electron.llamacpp.getServiceConfig();
      const nextConfig = await window.electron.llamacpp.setServiceConfig({
        ...previousConfig,
        memoryPolicy: draftMemoryPolicy,
        ...(draftMemoryPolicy === LlamaCppMemoryPolicy.Manual
          ? { memoryBudgetPercent: draftMemoryBudgetPercent }
          : {}),
      });
      setDraftMemoryPolicy(resolveMemoryPolicy(nextConfig));
      setDraftMemoryBudgetPercent(resolveMemoryBudgetPercent(nextConfig));
      setMemorySettingsOpen(false);
      showToast(
        i18nService.t('localInferenceMemorySettingsSaved'),
        LocalInferenceToastKind.Success,
      );
    });
  }, [draftMemoryBudgetPercent, draftMemoryPolicy, runAction, showToast]);

  return {
    memorySettingsOpen,
    draftMemoryPolicy,
    draftMemoryBudgetPercent,
    systemMemorySnapshot,
    setDraftMemoryPolicy,
    setDraftMemoryBudgetPercent: percent => {
      setDraftMemoryBudgetPercent(clampMemoryBudgetPercent(percent));
    },
    openMemorySettings,
    closeMemorySettings,
    saveMemorySettings,
  };
}

export function resolveMemoryPolicy(config: LlamaCppServiceConfig): LlamaCppMemoryPolicyType {
  return config.memoryPolicy === LlamaCppMemoryPolicy.Manual
    ? LlamaCppMemoryPolicy.Manual
    : LlamaCppMemoryPolicy.Auto;
}

export function resolveMemoryBudgetPercent(config: LlamaCppServiceConfig): number {
  return clampMemoryBudgetPercent(
    config.memoryBudgetPercent ?? LLAMACPP_MEMORY_BUDGET_PERCENT.Default,
  );
}

export function clampMemoryBudgetPercent(percent: number): number {
  const rounded =
    Math.round(percent / LLAMACPP_MEMORY_BUDGET_PERCENT.Step) * LLAMACPP_MEMORY_BUDGET_PERCENT.Step;
  return Math.min(
    LLAMACPP_MEMORY_BUDGET_PERCENT.Max,
    Math.max(LLAMACPP_MEMORY_BUDGET_PERCENT.Min, rounded),
  );
}
