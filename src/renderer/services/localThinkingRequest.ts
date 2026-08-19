import { ProviderName } from '../../shared/providers';

export type DirectChatRequestOptions = {
  conversationId?: string;
  modelId?: string;
  modelProviderKey?: string;
  localThinkingEnabled?: boolean;
  contextWindowTokens?: number;
};

export function buildLocalThinkingRequestParams(
  provider: string,
  localThinkingEnabled: boolean | undefined,
): { chat_template_kwargs?: { enable_thinking: boolean } } {
  if (provider !== ProviderName.LlamaCpp || localThinkingEnabled === undefined) {
    return {};
  }
  return {
    chat_template_kwargs: {
      enable_thinking: localThinkingEnabled,
    },
  };
}
