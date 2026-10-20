import { createModels, createProvider, type Models } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import type { ModelRef } from '@earendil-works/pi-durable';
import { ZhiyuanModelPoolWorkload } from '../../../../shared/modelPool/constants';
import {
  getMagpieModelService,
  hasMagpieModelService,
  MAGPIE_RUNTIME_API_KEY,
} from '../../../magpie/modelService';
import { buildMagpiePiModel } from '../piMagpiePiModel';

export interface DurableMagpieProvider {
  model: ModelRef;
  models: Models;
}

export async function resolveDurableProvider(
  conversationId: string,
): Promise<DurableMagpieProvider> {
  if (!hasMagpieModelService()) {
    throw new Error('Unified model service is not initialized');
  }
  const { model: selected, gatewayUrl } = await getMagpieModelService().resolve();
  const {
    model: chatModel,
    baseUrl,
    api,
  } = buildMagpiePiModel(selected, gatewayUrl, {
    conversationId,
    workload: ZhiyuanModelPoolWorkload.Work,
  });
  const apiImpl =
    api === 'anthropic-messages'
      ? anthropicMessagesApi()
      : api === 'openai-responses'
        ? openAIResponsesApi()
        : openAICompletionsApi();
  const provider = createProvider({
    id: 'magpie',
    name: 'magpie',
    baseUrl,
    auth: {
      apiKey: {
        name: 'Magpie gateway',
        resolve: async () => ({ auth: { apiKey: MAGPIE_RUNTIME_API_KEY } }),
      },
    },
    models: [chatModel as never],
    api: apiImpl,
  });
  const models = createModels();
  models.setProvider(provider);
  return {
    model: { provider: 'magpie', modelId: selected.id },
    models,
  };
}
