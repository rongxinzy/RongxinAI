/**
 * Resolves a Pi session model through the owned gateway.
 *
 * The gateway URL must be a loopback origin. Image support follows the
 * catalog modalities, then the learned rejection verdict.
 */

import {
  ZhiyuanModelPoolHeader,
  type ZhiyuanModelPoolWorkload as ZhiyuanModelPoolWorkloadValue,
} from '../../../shared/modelPool/constants';
import { ModelCapabilityStatus, ProviderName } from '../../../shared/providers';
import type { MagpieModel } from '../../../shared/magpie/types';
import {
  getMagpieModelService,
  hasMagpieModelService,
  MAGPIE_RUNTIME_API_KEY,
} from '../../magpie/modelService';
import { ImageInputVerdict, imageInputVerdict } from './piImageInputFallback';
import type { PiModelRuntime, PiModules, PiResolvedModel } from './piRuntimeSessionState';

export const DEFAULT_PI_LOCAL_MAX_TOKENS = 4096;

export interface ModelPoolRequestContext {
  conversationId: string;
  workload: ZhiyuanModelPoolWorkloadValue;
}

export function magpieImageInput(model: MagpieModel): ModelCapabilityStatus {
  if (!model.modalities) return ModelCapabilityStatus.Unknown;
  return model.modalities.input?.includes('image')
    ? ModelCapabilityStatus.Supported
    : ModelCapabilityStatus.Unsupported;
}

const MAGPIE_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

function buildMagpiePiModel(
  selected: MagpieModel,
  gatewayUrl: string,
  modelPoolRequestContext?: ModelPoolRequestContext,
): {
  model: Record<string, unknown>;
  baseUrl: string;
  api: string;
  supportsImage: boolean;
  maxTokens: number;
} {
  const url = new URL(gatewayUrl);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Invalid owned model gateway URL');
  }
  const endpoints = selected.native_endpoints ?? [];
  const api = endpoints.includes('/v1/responses')
    ? 'openai-responses'
    : endpoints.includes('/v1/messages')
      ? 'anthropic-messages'
      : 'openai-completions';
  const levels = selected.supported_reasoning_levels?.map(level => level.effort) ?? [];
  const thinkingLevelMap = levels.length
    ? Object.fromEntries(
        MAGPIE_THINKING_LEVELS.map(level => {
          const effort = level === 'off' ? 'none' : level;
          return [level, levels.includes(effort) ? effort : null];
        }),
      )
    : undefined;
  const contextWindow = selected.context_window ?? 32768;
  const maxTokens = Math.min(selected.max_output_tokens ?? 4096, contextWindow);
  const baseUrl = api === 'anthropic-messages' ? url.origin : `${url.origin}/v1`;
  const imageInput = magpieImageInput(selected);
  const supportsImage = imageInput === ModelCapabilityStatus.Supported;

  const model: Record<string, unknown> = {
    id: selected.id,
    name: selected.display_name || selected.id,
    provider: 'magpie',
    api,
    baseUrl,
    reasoning: selected.reasoning === true,
    input: supportsImage ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    compat: { sendSessionAffinityHeaders: true },
    headers: {
      ...(modelPoolRequestContext?.conversationId
        ? {
            'X-Magpie-Session': modelPoolRequestContext.conversationId,
            [ZhiyuanModelPoolHeader.ConversationId]: modelPoolRequestContext.conversationId,
            [ZhiyuanModelPoolHeader.Workload]: modelPoolRequestContext.workload,
          }
        : {}),
    },
  };

  return { model, baseUrl, api, supportsImage, maxTokens };
}

export async function resolvePiModel(
  pi: PiModules,
  modelRef?: string,
  existingModelRuntime?: PiModelRuntime | null,
  modelPoolRequestContext?: ModelPoolRequestContext,
): Promise<PiResolvedModel> {
  if (hasMagpieModelService()) {
    const magpieService = getMagpieModelService();
    const resolution = await magpieService.resolve(modelRef);
    const {
      model: customModel,
      baseUrl,
      api,
      maxTokens,
    } = buildMagpiePiModel(resolution.model, resolution.gatewayUrl, modelPoolRequestContext);
    const modelRuntime =
      existingModelRuntime ?? (await pi.ModelRuntime.create({ allowModelNetwork: false }));
    modelRuntime.registerProvider('magpie', {
      name: 'magpie',
      baseUrl,
      api,
      models: [customModel],
    });
    await modelRuntime.setRuntimeApiKey('magpie', MAGPIE_RUNTIME_API_KEY);

    const imageInput = magpieImageInput(resolution.model);
    const effectiveImageInput = imageInputVerdict(
      imageInput,
      ProviderName.Magpie,
      resolution.model.id,
      {
        supportsImage: imageInput === ModelCapabilityStatus.Supported,
        imageInput,
        endpointKey: baseUrl,
      },
    );
    const model =
      effectiveImageInput === ImageInputVerdict.Supported
        ? customModel
        : { ...customModel, input: ['text'] as Array<'text' | 'image'> };

    return {
      model,
      endpointKey: baseUrl,
      modelRuntime,
      maxOutputTokens: maxTokens,
      providerName: ProviderName.Magpie,
      capabilities: { imageInput },
      requestOptions: { apiKey: MAGPIE_RUNTIME_API_KEY },
    };
  }

  throw new Error('Enable the unified model service in model settings before starting a task.');
}
