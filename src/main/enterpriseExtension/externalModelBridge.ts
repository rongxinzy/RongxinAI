import type { ModelCapabilities } from '../../shared/providers';
import { ModelCapabilityStatus } from '../../shared/providers';
import {
  ExternalModelProtocol,
  type ExternalModel,
  type ExternalModelConnection,
  type ExternalModelDescriptor,
  type ResolvedExternalModel,
} from '../../shared/externalModels';
import {
  EXTERNAL_MODEL_CAPABILITY_API_VERSION,
  type ExternalModelHostCapability,
  type ExternalModelProvider,
} from './contract';

const EXTERNAL_PROVIDER_ID_PATTERN = /^external\.[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAX_DISPLAY_NAME_LENGTH = 128;
const MAX_MODELS_PER_PROVIDER = 256;
const MAX_API_KEY_LENGTH = 16_384;
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const CAPABILITY_VALUES = new Set(Object.values(ModelCapabilityStatus));

type ErrorLogger = (message: string) => void;

interface RegisteredProvider {
  readonly provider: ExternalModelProvider;
  readonly disposeChangeListener: (() => void) | null;
}

export class ExternalModelBridge implements ExternalModelHostCapability {
  readonly apiVersion = EXTERNAL_MODEL_CAPABILITY_API_VERSION;
  readonly #providers = new Map<string, RegisteredProvider>();
  readonly #listeners = new Set<() => void>();
  readonly #logError: ErrorLogger;

  constructor(
    logError: ErrorLogger = message => {
      console.error(message);
    },
  ) {
    this.#logError = logError;
  }

  registerProvider(provider: ExternalModelProvider): () => void {
    const normalized = normalizeProvider(provider);
    if (this.#providers.has(normalized.id)) {
      throw new Error(`External model provider ${normalized.id} is already registered.`);
    }
    let disposeChangeListener: (() => void) | null = null;
    try {
      disposeChangeListener = normalized.onDidChange?.(() => this.#emitChanged()) ?? null;
    } catch {
      throw new Error(`External model provider ${normalized.id} could not subscribe to changes.`);
    }
    this.#providers.set(normalized.id, { provider: normalized, disposeChangeListener });
    this.#emitChanged();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const current = this.#providers.get(normalized.id);
      if (current?.provider !== normalized) return;
      try {
        current.disposeChangeListener?.();
      } catch {
        this.#logError(`[ExternalModels] Could not release ${normalized.id} change listener.`);
      }
      this.#providers.delete(normalized.id);
      this.#emitChanged();
    };
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async listModels(): Promise<readonly ExternalModel[]> {
    const groups = await Promise.all(
      [...this.#providers.values()].map(async ({ provider }) => {
        try {
          return await listProviderModels(provider);
        } catch {
          this.#logError(`[ExternalModels] Could not list models for ${provider.id}.`);
          return [];
        }
      }),
    );
    return Object.freeze(groups.flat());
  }

  async resolveModelRef(modelRef: string): Promise<ResolvedExternalModel | null> {
    const separator = modelRef.indexOf('/');
    if (separator <= 0 || separator === modelRef.length - 1) return null;
    const providerId = modelRef.slice(0, separator);
    const modelId = modelRef.slice(separator + 1);
    const registered = this.#providers.get(providerId);
    if (!registered) return null;

    const models = await listProviderModels(registered.provider);
    const model = models.find(candidate => candidate.id === modelId);
    if (!model) {
      throw new Error(`External model ${providerId}/${modelId} is unavailable.`);
    }
    let connectionValue: ExternalModelConnection;
    try {
      connectionValue = await registered.provider.resolveConnection(modelId);
    } catch {
      throw new Error(`External model provider ${providerId} could not resolve a connection.`);
    }
    const connection = normalizeConnection(connectionValue);
    return Object.freeze({ ...model, connection });
  }

  #emitChanged(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        this.#logError('[ExternalModels] A model change listener failed.');
      }
    }
  }
}

export const externalModelBridge = new ExternalModelBridge();

function normalizeProvider(provider: ExternalModelProvider): ExternalModelProvider {
  if (!provider || typeof provider !== 'object') {
    throw new Error('External model provider is invalid.');
  }
  const id = normalizedString(provider.id, 64);
  const displayName = normalizedString(provider.displayName, MAX_DISPLAY_NAME_LENGTH);
  if (!id || !EXTERNAL_PROVIDER_ID_PATTERN.test(id)) {
    throw new Error('External model provider ID is invalid.');
  }
  if (!displayName) throw new Error('External model provider display name is invalid.');
  if (
    typeof provider.listModels !== 'function' ||
    typeof provider.resolveConnection !== 'function'
  ) {
    throw new Error('External model provider is incomplete.');
  }
  if (provider.onDidChange !== undefined && typeof provider.onDidChange !== 'function') {
    throw new Error('External model provider change listener is invalid.');
  }
  return Object.freeze({
    id,
    displayName,
    listModels: () => provider.listModels(),
    resolveConnection: (modelId: string) => provider.resolveConnection(modelId),
    ...(provider.onDidChange
      ? { onDidChange: (listener: () => void) => provider.onDidChange!(listener) }
      : {}),
  });
}

async function listProviderModels(provider: ExternalModelProvider): Promise<ExternalModel[]> {
  let value: readonly ExternalModelDescriptor[];
  try {
    value = await provider.listModels();
  } catch {
    throw new Error(`External model provider ${provider.id} could not list models.`);
  }
  if (!Array.isArray(value) || value.length > MAX_MODELS_PER_PROVIDER) {
    throw new Error('External model provider returned an invalid model list.');
  }
  const ids = new Set<string>();
  return value.map(candidate => {
    const model = normalizeModel(candidate);
    if (ids.has(model.id)) {
      throw new Error(`External model provider returned duplicate model ID ${model.id}.`);
    }
    ids.add(model.id);
    return Object.freeze({
      ...model,
      provider: Object.freeze({ id: provider.id, displayName: provider.displayName }),
    });
  });
}

function normalizeModel(value: ExternalModelDescriptor): ExternalModelDescriptor {
  if (!value || typeof value !== 'object') throw new Error('External model is invalid.');
  const id = normalizedString(value.id, 256);
  const displayName = normalizedString(value.displayName, MAX_DISPLAY_NAME_LENGTH);
  if (!id || !MODEL_ID_PATTERN.test(id)) throw new Error('External model ID is invalid.');
  if (!displayName) throw new Error('External model display name is invalid.');
  if (value.protocol !== ExternalModelProtocol.OpenAICompatible) {
    throw new Error('External model protocol is not supported.');
  }
  const capabilities = normalizeCapabilities(value.capabilities);
  const contextWindow = positiveInteger(value.contextWindow);
  if (value.contextWindow !== undefined && !contextWindow) {
    throw new Error('External model context window is invalid.');
  }
  if (value.isDefault !== undefined && typeof value.isDefault !== 'boolean') {
    throw new Error('External model default flag is invalid.');
  }
  return Object.freeze({
    id,
    displayName,
    protocol: ExternalModelProtocol.OpenAICompatible,
    ...(capabilities ? { capabilities } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(value.isDefault === undefined ? {} : { isDefault: value.isDefault }),
  });
}

function normalizeCapabilities(
  value: Partial<ModelCapabilities> | undefined,
): Partial<ModelCapabilities> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('External model capabilities are invalid.');
  }
  const normalized: {
    -readonly [Key in keyof ModelCapabilities]?: ModelCapabilities[Key];
  } = {};
  for (const key of Object.keys(value) as Array<keyof ModelCapabilities>) {
    const status = value[key];
    if (!CAPABILITY_VALUES.has(status as ModelCapabilityStatus)) {
      throw new Error(`External model capability ${key} is invalid.`);
    }
    normalized[key] = status;
  }
  return Object.freeze(normalized);
}

function normalizeConnection(value: ExternalModelConnection): ExternalModelConnection {
  if (!value || typeof value !== 'object') throw new Error('External model connection is invalid.');
  const baseUrl = normalizedString(value.baseUrl, 2048);
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
  const modelId = normalizedString(value.modelId, 256);
  if (!baseUrl || !isHttpUrl(baseUrl)) throw new Error('External model base URL is invalid.');
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) {
    throw new Error('External model API key is invalid.');
  }
  if (!modelId) throw new Error('External runtime model ID is invalid.');
  return Object.freeze({ baseUrl, apiKey, modelId });
}

function normalizedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isHttpUrl(value: string): boolean {
  try {
    return HTTP_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
