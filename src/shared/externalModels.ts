import type { ModelCapabilities } from './providers';

export const ExternalModelAccessMode = {
  Open: 'open',
  Exclusive: 'exclusive',
} as const;
export type ExternalModelAccessMode =
  (typeof ExternalModelAccessMode)[keyof typeof ExternalModelAccessMode];

export interface ExternalModelAccessPolicy {
  readonly mode: ExternalModelAccessMode;
  readonly providerIds: readonly string[];
}

export const OPEN_EXTERNAL_MODEL_ACCESS_POLICY: ExternalModelAccessPolicy = Object.freeze({
  mode: ExternalModelAccessMode.Open,
  providerIds: Object.freeze([]),
});

export const ExternalModelProtocol = {
  OpenAICompatible: 'openai-compatible',
} as const;
export type ExternalModelProtocol =
  (typeof ExternalModelProtocol)[keyof typeof ExternalModelProtocol];

export const ExternalModelThinkingFormat = {
  DeepSeek: 'deepseek',
} as const;
export type ExternalModelThinkingFormat =
  (typeof ExternalModelThinkingFormat)[keyof typeof ExternalModelThinkingFormat];

export interface ExternalModelReasoningCompatibility {
  readonly thinkingFormat: ExternalModelThinkingFormat;
  readonly supportsReasoningEffort: boolean;
  readonly requiresReasoningContentOnAssistantMessages: boolean;
}

export interface ExternalModelDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: ExternalModelProtocol;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly reasoningCompatibility?: ExternalModelReasoningCompatibility;
  readonly contextWindow?: number;
  readonly isDefault?: boolean;
}

export interface ExternalModelProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
}

export interface ExternalModel extends ExternalModelDescriptor {
  readonly provider: ExternalModelProviderDescriptor;
}

export interface ExternalModelConnection {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
}

export interface ResolvedExternalModel extends ExternalModel {
  readonly connection: ExternalModelConnection;
}
