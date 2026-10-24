import { createModels, createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import type { ModelRef } from '@earendil-works/pi-durable';
import {
  CompanionCapability,
  CompanionUnavailableReason,
} from '../../shared/companion/constants.js';
import type { CompanionAvailability } from '../../shared/companion/types.js';
import { ZhiyuanModelPoolWorkload } from '../../shared/modelPool/constants.js';
import { buildMagpiePiModel } from '../libs/agentEngine/piMagpiePiModel.js';
import { MAGPIE_RUNTIME_API_KEY, type MagpieModelService } from '../magpie/modelService.js';

// Native ESM preserves pi-ai's import-only exports in the CommonJS Electron host.

const COOLDOWN_MS = 60_000;
const MAX_FAILURES = 64;

/** Failure observations are bounded and expire; a catalog entry is not a health check. */
export class CompanionModelAssignment {
  private readonly failures = new Map<string, number>();
  constructor(
    private readonly service: MagpieModelService,
    private readonly now: () => number = Date.now,
  ) {}

  failed(modelId: string): void {
    this.failures.delete(modelId);
    this.failures.set(modelId, this.now() + COOLDOWN_MS);
    if (this.failures.size > MAX_FAILURES) this.failures.delete(this.failures.keys().next().value!);
  }

  async resolve(conversationId: string) {
    try {
      return await this.resolveAvailable(conversationId);
    } catch {
      // A stopped gateway or a failed catalog read must not disable local drafts and identity.
      const availability: CompanionAvailability = {
        capability: CompanionCapability.Local,
        modelId: null,
        imageInput: false,
        toolUse: false,
        reason: CompanionUnavailableReason.ServiceUnavailable,
      };
      return { models: createModels(), model: null, availability };
    }
  }

  private async resolveAvailable(conversationId: string) {
    for (const [id, until] of this.failures) if (until <= this.now()) this.failures.delete(id);
    const selected = await this.service.resolveAutomatic(new Set(this.failures.keys()));
    const models = createModels();
    if (!selected) {
      const availability: CompanionAvailability = {
        capability: CompanionCapability.Local,
        modelId: null,
        imageInput: false,
        toolUse: false,
        reason: this.failures.size
          ? CompanionUnavailableReason.ModelFailed
          : CompanionUnavailableReason.NoModel,
      };
      return { models, model: null, availability };
    }
    const projection = buildMagpiePiModel(selected.model, selected.gatewayUrl, {
      conversationId,
      workload: ZhiyuanModelPoolWorkload.Chat,
    });
    models.setProvider(
      createProvider({
        id: 'magpie',
        baseUrl: projection.baseUrl,
        auth: {
          apiKey: {
            name: 'Magpie gateway',
            resolve: async () => ({ auth: { apiKey: MAGPIE_RUNTIME_API_KEY } }),
          },
        },
        models: [projection.model],
        api:
          projection.api === 'anthropic-messages'
            ? anthropicMessagesApi()
            : projection.api === 'openai-responses'
              ? openAIResponsesApi()
              : openAICompletionsApi(),
      }),
    );
    const model: ModelRef = { provider: 'magpie', modelId: selected.model.id };
    const availability: CompanionAvailability = {
      capability: CompanionCapability.Chat,
      modelId: selected.model.id,
      imageInput: projection.supportsImage,
      toolUse: false,
    };
    return { models, model, availability };
  }
}
