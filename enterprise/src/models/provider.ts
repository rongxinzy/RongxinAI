import type { AgentModel, ModelConnection } from '@aep/sdk-node';

import {
  type ModelCapabilities,
  ModelCapabilityStatus,
  type ProviderConfig,
  type ProviderModelPiRuntimeConfig,
  type ProviderModelPiThinkingLevel,
  type ProviderModelPiThinkingLevelMap,
  ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION,
  type ZhiyuanManagedProviderSource,
} from '../host-contract.js';
import type { ZhiyuanPasswordSession } from '../session/password-session.js';

export const ZHIYUAN_MODEL_PROVIDER_KEY = 'custom_enterprise';
export const ZHIYUAN_MODEL_PROVIDER_DISPLAY_NAME = 'Zhiyuan';
export const ZHIYUAN_MODEL_POLL_INTERVAL_MS = 30_000;

/** Host capability version that accepts anthropic managed models (per-model baseUrl + apiFormat passthrough). */
const HOST_MANAGED_PROVIDER_ANTHROPIC_API_VERSION = 2;

interface TimerHandle {
  unref?(): void;
}

export interface ZhiyuanModelProviderDependencies {
  readonly pollIntervalMs?: number;
  readonly setInterval?: (callback: () => void, milliseconds: number) => TimerHandle;
  readonly clearInterval?: (handle: TimerHandle) => void;
  readonly getEntitlementToken?: () => string | null;
  readonly requireEntitlement?: boolean;
  readonly onEntitlementChange?: (listener: () => void) => () => void;
  readonly refreshEntitlement?: () => Promise<unknown>;
  /** Host managed-provider capability version; hosts below v2 only receive OpenAI-compatible models. */
  readonly hostManagedProviderApiVersion?: number;
}

export class ZhiyuanModelProvider implements ZhiyuanManagedProviderSource {
  readonly providerKey = ZHIYUAN_MODEL_PROVIDER_KEY;
  readonly exclusive = true;
  readonly #session: ZhiyuanPasswordSession;
  readonly #pollIntervalMs: number;
  readonly #setInterval: (callback: () => void, milliseconds: number) => TimerHandle;
  readonly #clearInterval: (handle: TimerHandle) => void;
  readonly #getEntitlementToken: (() => string | null) | null;
  readonly #requireEntitlement: boolean;
  readonly #onEntitlementChange: ((listener: () => void) => () => void) | null;
  readonly #refreshEntitlement: (() => Promise<unknown>) | null;
  readonly #hostManagedProviderApiVersion: number;
  #entitlementUnsubscribe: (() => void) | null = null;
  readonly #listeners = new Set<() => void>();
  #sessionUnsubscribe: (() => void) | null = null;
  #pollTimer: TimerHandle | null = null;
  #pollInFlight = false;

  constructor(
    session: ZhiyuanPasswordSession,
    dependencies: ZhiyuanModelProviderDependencies = {},
  ) {
    this.#session = session;
    this.#pollIntervalMs = dependencies.pollIntervalMs ?? ZHIYUAN_MODEL_POLL_INTERVAL_MS;
    this.#setInterval =
      dependencies.setInterval ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
    this.#clearInterval = dependencies.clearInterval ?? (handle => clearInterval(handle as never));
    this.#getEntitlementToken = dependencies.getEntitlementToken ?? null;
    this.#requireEntitlement = dependencies.requireEntitlement === true;
    this.#onEntitlementChange = dependencies.onEntitlementChange ?? null;
    this.#refreshEntitlement = dependencies.refreshEntitlement ?? null;
    this.#hostManagedProviderApiVersion =
      dependencies.hostManagedProviderApiVersion ?? ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION;
  }

  async snapshot(): Promise<ProviderConfig> {
    await this.#refreshEntitlement?.();
    const [models, connection] = await Promise.all([
      this.#readModels(),
      this.#session.getModelConnection(),
    ]);
    validateGatewayConnection(connection);
    const entitlementToken = this.#getEntitlementToken?.() ?? null;
    if (this.#requireEntitlement && !entitlementToken) {
      throw new Error('Zhiyuan enterprise model access requires an active License entitlement.');
    }
    return {
      enabled: true,
      userEnabled: true,
      apiKey: entitlementToken ?? connection.apiKey,
      baseUrl: connection.baseUrl,
      // The provider-level format stays openai even for mixed catalogs: the host
      // gates anthropic proxying off the per-model piRuntime api, while OpenAI
      // models require an openai provider format to use the managed proxy.
      apiFormat: 'openai',
      displayName: ZHIYUAN_MODEL_PROVIDER_DISPLAY_NAME,
      models: models.map(model => toProviderModel(model, connection)),
    };
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#startWatching();
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#stopWatching();
    };
  }

  async #readModels(): Promise<AgentModel[]> {
    const { models } = await this.#session.listAgentModels();
    return models
      .filter(isGatewayModel)
      .filter(
        model =>
          this.#hostManagedProviderApiVersion >= HOST_MANAGED_PROVIDER_ANTHROPIC_API_VERSION ||
          model.protocol === 'openai-compatible',
      )
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
  }

  #startWatching(): void {
    this.#sessionUnsubscribe = this.#session.onDidChange(() => {
      this.#emitChanged();
    });
    this.#entitlementUnsubscribe = this.#onEntitlementChange?.(() => this.#emitChanged()) ?? null;
    this.#pollTimer = this.#setInterval(() => void this.#poll(), this.#pollIntervalMs);
    this.#pollTimer.unref?.();
  }

  #stopWatching(): void {
    this.#sessionUnsubscribe?.();
    this.#sessionUnsubscribe = null;
    this.#entitlementUnsubscribe?.();
    this.#entitlementUnsubscribe = null;
    if (this.#pollTimer) this.#clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  async #poll(): Promise<void> {
    if (this.#pollInFlight) return;
    this.#pollInFlight = true;
    try {
      await this.#refreshEntitlement?.();
      await this.#readModels();
    } catch {
      // The host refresh below will clear the stale provider snapshot.
    } finally {
      this.#pollInFlight = false;
      // Refreshes the short-lived model token and clears stale snapshots on outages.
      this.#emitChanged();
    }
  }

  #emitChanged(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // Host notification failures must not stop authorization polling.
      }
    }
  }
}

function isGatewayModel(model: AgentModel): boolean {
  return (
    model.enabled &&
    model.sourceType === 'gateway' &&
    (model.protocol === 'openai-compatible' || model.protocol === 'anthropic')
  );
}

function toProviderModel(
  model: AgentModel,
  connection: ModelConnection,
): NonNullable<ProviderConfig['models']>[number] {
  const capabilities = mapCapabilities(model.capabilities);
  const base = {
    id: model.id,
    name: model.displayName,
    ...(capabilities.imageInput === ModelCapabilityStatus.Supported ? { supportsImage: true } : {}),
    ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
  };
  if (model.protocol === 'anthropic') {
    return {
      ...base,
      baseUrl: deriveAnthropicModelBaseUrl(connection.baseUrl, model.id),
      piRuntime: { api: 'anthropic-messages' as const },
    };
  }
  const piRuntime = mapPiRuntime(model);
  return {
    ...base,
    ...(piRuntime ? { piRuntime } : {}),
  };
}

/**
 * Anthropic gateway routes live under a per-model path prefix: the model's
 * base URL is the gateway origin plus the model id (model ids share the
 * gateway slug alphabet). The OpenAI metadata connection reports
 * `<origin>/v1`, so strip trailing slashes and a trailing `/v1` segment.
 */
function deriveAnthropicModelBaseUrl(connectionBaseUrl: string, modelId: string): string {
  const normalized = connectionBaseUrl.trim().replace(/\/+$/, '');
  const origin = normalized.endsWith('/v1') ? normalized.slice(0, -'/v1'.length) : normalized;
  return `${origin}/${modelId}`;
}

type AepReasoningAwareAgentModel = Omit<AgentModel, 'reasoningCompatibility'> & {
  readonly reasoningCompatibility?: {
    readonly thinkingFormat: 'deepseek' | 'zai';
    readonly supportsReasoningEffort: true;
    readonly requiresReasoningContentOnAssistantMessages: true;
    readonly thinkingLevelMap?: Partial<Record<ProviderModelPiThinkingLevel, string | null>>;
  };
};

function mapPiRuntime(model: AgentModel): ProviderModelPiRuntimeConfig | undefined {
  const value = (model as AepReasoningAwareAgentModel).reasoningCompatibility;
  if (value === undefined) return undefined;
  if (
    (value.thinkingFormat !== 'deepseek' && value.thinkingFormat !== 'zai') ||
    value.supportsReasoningEffort !== true ||
    value.requiresReasoningContentOnAssistantMessages !== true
  ) {
    throw new Error('Zhiyuan model reasoning compatibility is not supported.');
  }
  return {
    api: 'openai-completions',
    reasoning: true,
    ...(value.thinkingLevelMap
      ? { thinkingLevelMap: normalizeThinkingLevelMap(value.thinkingLevelMap) }
      : {}),
    compat: {
      thinkingFormat: value.thinkingFormat,
      supportsReasoningEffort: true,
      requiresReasoningContentOnAssistantMessages: true,
    },
  };
}

function normalizeThinkingLevelMap(
  value: Partial<Record<ProviderModelPiThinkingLevel, string | null>>,
): ProviderModelPiThinkingLevelMap {
  const normalized: ProviderModelPiThinkingLevelMap = {};
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
    const mapped = value[level];
    if (mapped === null || (typeof mapped === 'string' && mapped.trim() !== '')) {
      normalized[level] = mapped;
    }
  }
  return normalized;
}

function mapCapabilities(values: string[]): Partial<ModelCapabilities> {
  const capabilities = new Set(values.map(value => value.trim().toLowerCase()));
  return {
    ...(hasAny(capabilities, 'tools', 'tool-calling', 'tool_calling')
      ? { toolCalling: ModelCapabilityStatus.Supported }
      : {}),
    ...(hasAny(capabilities, 'vision', 'image', 'image-input', 'image_input')
      ? { imageInput: ModelCapabilityStatus.Supported }
      : {}),
    ...(hasAny(capabilities, 'video', 'video-input', 'video_input')
      ? { videoInput: ModelCapabilityStatus.Supported }
      : {}),
    ...(hasAny(capabilities, 'audio', 'audio-input', 'audio_input')
      ? { audioInput: ModelCapabilityStatus.Supported }
      : {}),
    ...(hasAny(capabilities, 'document', 'document-input', 'document_input')
      ? { documentInput: ModelCapabilityStatus.Supported }
      : {}),
    ...(capabilities.has('reasoning') ? { reasoning: ModelCapabilityStatus.Supported } : {}),
  };
}

function hasAny(values: ReadonlySet<string>, ...candidates: string[]): boolean {
  return candidates.some(candidate => values.has(candidate));
}

function validateGatewayConnection(connection: ModelConnection): void {
  if (connection.protocol !== 'openai-compatible') {
    throw new Error('Zhiyuan model gateway protocol is not supported.');
  }
}
