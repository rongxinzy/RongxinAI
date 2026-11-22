/**
 * Resolves a Pi session model through the owned gateway.
 *
 * The gateway URL must be a loopback origin. Image support follows the
 * catalog modalities.
 */

import type { Model } from '@earendil-works/pi-ai';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../../shared/magpie/constants';
import {
  ZhiyuanModelPoolHeader,
  ZhiyuanModelPoolWorkload,
  type ZhiyuanModelPoolWorkload as ZhiyuanModelPoolWorkloadValue,
} from '../../../shared/modelPool/constants';
import { ModelCapabilityStatus, ProviderName } from '../../../shared/providers';
import type { MagpieModel, MagpieProviderSummary } from '../../../shared/magpie/types';
import {
  MAGPIE_RUNTIME_API_KEY,
  MAGPIE_ENTERPRISE_CHAT_WORKLOAD,
  MagpieWorkHeader,
  type MagpieModelService,
} from '../../magpie/modelService';
import { t } from '../../i18n';
import { magpieImageInput } from '../../magpie/catalog';
import { resolveMagpieFallbackMaxTokens, resolveMagpieModelCompat } from './piMagpieModelCompat';
import { wrapMagpieNativeApi } from './piMagpieApiGuard';
import type { PiModelRuntime, PiModules, PiResolvedModel } from './piRuntimeSessionState';

export const DEFAULT_PI_LOCAL_MAX_TOKENS = 8192;
type MagpieNativeApi = 'openai-responses' | 'anthropic-messages' | 'openai-completions';

export interface ModelPoolRequestContext {
  conversationId: string;
  workload: ZhiyuanModelPoolWorkloadValue;
  requirePublishedModel?: boolean;
}

const MAGPIE_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

function buildMagpiePiModel(
  selected: MagpieModel,
  gatewayUrl: string,
  modelPoolRequestContext?: ModelPoolRequestContext,
  upstreamProvider?: MagpieProviderSummary,
): {
  model: Model<MagpieNativeApi> & Record<string, unknown>;
  baseUrl: string;
  api: MagpieNativeApi;
  imageInput: ModelCapabilityStatus;
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
  const api: MagpieNativeApi = endpoints.includes('/v1/responses')
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
  const maxTokens = resolveMagpieFallbackMaxTokens(
    selected,
    contextWindow,
    DEFAULT_PI_LOCAL_MAX_TOKENS,
  );
  const baseUrl = api === 'anthropic-messages' ? url.origin : `${url.origin}/v1`;
  const imageInput = magpieImageInput(selected);
  const supportsImage = imageInput === ModelCapabilityStatus.Supported;

  const model: Model<MagpieNativeApi> & Record<string, unknown> = {
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
    compat: resolveMagpieModelCompat(selected, api, upstreamProvider),
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

  return { model, baseUrl, api, imageInput, maxTokens };
}

export async function resolvePiModel(
  pi: PiModules,
  magpieService: MagpieModelService | undefined,
  modelRef?: string,
  existingModelRuntime?: PiModelRuntime,
  modelPoolRequestContext?: ModelPoolRequestContext,
): Promise<PiResolvedModel> {
  if (magpieService) {
    const work = modelPoolRequestContext?.workload === ZhiyuanModelPoolWorkload.Work;
    const routeOptions = {
      work,
      requirePublishedModel: modelPoolRequestContext?.requirePublishedModel,
    };
    const resolution = await magpieService.resolve(modelRef, routeOptions);
    const { isCurrentGateway } = resolution;
    const localGpu = resolution.gatewayModel.owned_by === LOCAL_GPU_MAGPIE_PROVIDER_ID;

    const {
      model: customModel,
      baseUrl,
      api,
      imageInput,
      maxTokens,
    } = buildMagpiePiModel(
      resolution.gatewayModel,
      resolution.gatewayUrl,
      modelPoolRequestContext,
      resolution.provider,
    );
    const modelRuntime =
      existingModelRuntime ?? (await pi.ModelRuntime.create({ allowModelNetwork: false }));
    const scope = work ? resolution.workRequest : resolution.enterpriseChatRequest;
    const requiresScope = work || Boolean(resolution.enterpriseChatRequest);
    let scopeKey = scope?.key;
    let scopeModels = scope?.models;
    if (requiresScope && (!scopeKey?.() || !scopeModels))
      throw new Error(t('coworkErrorModelNotFound'));
    const key = () =>
      isCurrentGateway() ? (requiresScope ? scopeKey?.() : MAGPIE_RUNTIME_API_KEY) : undefined;
    const nativeApi = wrapMagpieNativeApi(
      api === 'openai-responses'
        ? pi.openAIResponsesApi()
        : api === 'anthropic-messages'
          ? pi.anthropicMessagesApi()
          : pi.openAICompletionsApi(),
    );
    modelRuntime.registerNativeProvider(
      pi.createProvider({
        id: customModel.provider,
        baseUrl,
        api: nativeApi,
        models: [customModel],
        auth: {
          apiKey: {
            name: 'Desktop model access',
            check: async () => (key() ? { type: 'api_key' } : undefined),
            resolve: async ({ signal }) => {
              signal.throwIfAborted();
              const apiKey = key();
              const models = scopeModels?.();
              if (!apiKey || (requiresScope && !models))
                throw new Error(t('coworkErrorModelNotFound'));
              return {
                auth: {
                  apiKey,
                  baseUrl,
                  ...(models
                    ? {
                        headers: {
                          [MagpieWorkHeader.Workload]: work
                            ? ZhiyuanModelPoolWorkload.Work
                            : MAGPIE_ENTERPRISE_CHAT_WORKLOAD,
                          [MagpieWorkHeader.Models]: models,
                        },
                      }
                    : {}),
                },
              };
            },
          },
        },
      }),
    );

    const { id } = resolution.gatewayModel;
    const { routingGroupId, gatewayUrl } = resolution;
    const revalidateModelScope = requiresScope
      ? async () => {
          if (routingGroupId === undefined && !localGpu && scopeKey?.()) return;
          const current = await magpieService.resolve(id, routeOptions);
          if (
            current.gatewayModel.id !== id ||
            current.routingGroupId !== routingGroupId ||
            current.gatewayUrl !== gatewayUrl ||
            (routingGroupId === undefined &&
              (current.gatewayModel.owned_by === LOCAL_GPU_MAGPIE_PROVIDER_ID) !== localGpu)
          ) {
            throw new Error(t('coworkErrorModelNotFound'));
          }
          const currentScope = work ? current.workRequest : current.enterpriseChatRequest;
          if (!currentScope?.key()) throw new Error(t('coworkErrorModelNotFound'));
          scopeKey = currentScope.key;
          scopeModels = currentScope.models;
        }
      : undefined;

    return {
      model: customModel,
      isCurrentModelRoute: resolution.isCurrentRoute,
      modelRuntime,
      maxOutputTokens: maxTokens,
      providerName: ProviderName.Magpie,
      capabilities: { imageInput },
      revalidateModelScope,
    };
  }

  throw new Error('Enable the unified model service in model settings before starting a task.');
}
