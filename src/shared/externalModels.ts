import type { ModelCapabilities } from './providers';

export const ExternalModelProtocol = {
  OpenAICompatible: 'openai-compatible',
} as const;
export type ExternalModelProtocol =
  (typeof ExternalModelProtocol)[keyof typeof ExternalModelProtocol];

export interface ExternalModelDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: ExternalModelProtocol;
  readonly capabilities?: Partial<ModelCapabilities>;
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
