import { AuthType, ProviderName } from '../../../shared/providers';

interface ProviderModelAutoDetectionInput {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  authType?: string;
  requiresApiKey: boolean;
}

export function shouldAutoDetectProviderModels(
  input: ProviderModelAutoDetectionInput,
): boolean {
  if (input.providerId === ProviderName.LlamaCpp || !input.baseUrl.trim()) {
    return false;
  }

  return (
    !input.requiresApiKey ||
    input.authType === AuthType.OAuth ||
    Boolean(input.apiKey.trim())
  );
}
