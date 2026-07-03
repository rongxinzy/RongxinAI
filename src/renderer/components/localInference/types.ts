import type { LlamaCppChatChunk, LlamaCppInstallProgress } from '../../../shared/llamacpp';

export type LocalInferenceTab = 'inference' | 'models' | 'marketplace';

export type InferenceMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  waiting?: boolean;
  metrics?: LlamaCppChatChunk | null;
  createdAt: number;
  reasoningDurationSeconds?: number;
};

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

export type LocalInferenceInlineError = {
  kind: 'context-overflow';
  requestedTokens: number | null;
  availableTokens: number | null;
};

export type LocalInferenceSessionState = {
  activeTab: LocalInferenceTab;
  selectedModel: string;
  systemPrompt: string;
  prompt: string;
  messages: InferenceMessage[];
};

export type InstallProgressState = Record<string, LlamaCppInstallProgress>;

export type BuildAssistantMessageInput = {
  content: string;
  thinking: string;
  metrics?: LlamaCppChatChunk | null;
};

