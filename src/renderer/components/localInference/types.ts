import type { LlamaCppInstallProgress } from '../../../shared/llamacpp';

export type LocalInferenceTab = 'models' | 'marketplace';

export const LocalInferenceToastKind = {
  Success: 'success',
  Error: 'error',
  Info: 'info',
} as const;

export type LocalInferenceToastKind =
  (typeof LocalInferenceToastKind)[keyof typeof LocalInferenceToastKind];

export type LocalInferenceToast = {
  id: string;
  kind: LocalInferenceToastKind;
  message: string;
  autoDismiss: boolean;
};

export type LocalInferenceSessionState = {
  activeTab: LocalInferenceTab;
};

export type InstallProgressState = Record<string, LlamaCppInstallProgress>;

