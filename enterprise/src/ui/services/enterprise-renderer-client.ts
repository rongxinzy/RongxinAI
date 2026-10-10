import type {
  EnterprisePasswordChangeInput,
  EnterprisePasswordLoginInput,
  EnterpriseSessionResult,
  ManagedProviderCatalogModel,
  ModelCapabilities,
} from '../../host-contract.js';
import { ModelCapabilityStatus } from '../../host-contract.js';
import {
  type EnterpriseRendererInitializeMessage,
  EnterpriseRendererMessageSource,
  EnterpriseRendererMessageType,
  type EnterpriseRendererModelCatalogRequestMessage,
  type EnterpriseRendererModelCatalogResult,
  type EnterpriseRendererReadyMessage,
  EnterpriseRendererSessionOperation,
  type EnterpriseRendererSessionRequestMessage,
  type EnterpriseRendererSessionResponseMessage,
} from '../../renderer-contract.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MODELS = 256;

// The host v1 session bridge rejects login requests without a non-empty
// enterpriseId; the extension runtime derives the deployment from server
// metadata and ignores this value.
const HOST_LOGIN_ENTERPRISE_ID = 'server-metadata';

const PendingRequestKind = {
  Session: 'session',
  ModelCatalog: 'model-catalog',
} as const;

type PendingRequest =
  | {
      readonly kind: typeof PendingRequestKind.Session;
      readonly resolve: (result: EnterpriseSessionResult) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: number;
    }
  | {
      readonly kind: typeof PendingRequestKind.ModelCatalog;
      readonly resolve: (result: EnterpriseRendererModelCatalogResult) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: number;
    };

interface RequestLifecycle {
  readonly reject: (error: Error) => void;
  readonly timeout: number;
}

export class EnterpriseRendererClient {
  readonly #pending = new Map<string, PendingRequest>();
  #onInitialize: ((message: EnterpriseRendererInitializeMessage) => void) | null = null;
  #started = false;

  start(onInitialize: (message: EnterpriseRendererInitializeMessage) => void): () => void {
    this.#onInitialize = onInitialize;
    if (!this.#started) {
      this.#started = true;
      window.addEventListener('message', this.#handleMessage);
    }
    const ready: EnterpriseRendererReadyMessage = {
      source: EnterpriseRendererMessageSource.Module,
      apiVersion: 1,
      type: EnterpriseRendererMessageType.Ready,
    };
    window.parent.postMessage(ready, '*');
    return () => this.stop();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#onInitialize = null;
    window.removeEventListener('message', this.#handleMessage);
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error('Zhiyuan enterprise renderer stopped.'));
    }
    this.#pending.clear();
  }

  snapshot(): Promise<EnterpriseSessionResult> {
    return this.#request(EnterpriseRendererSessionOperation.Snapshot);
  }

  login(input: {
    aepBaseUrl: string;
    username: string;
    password: string;
  }): Promise<EnterpriseSessionResult> {
    return this.#request(EnterpriseRendererSessionOperation.Login, {
      ...input,
      enterpriseId: HOST_LOGIN_ENTERPRISE_ID,
    });
  }

  changePassword(input: EnterprisePasswordChangeInput): Promise<EnterpriseSessionResult> {
    return this.#request(EnterpriseRendererSessionOperation.ChangePassword, input);
  }

  logout(): Promise<EnterpriseSessionResult> {
    return this.#request(EnterpriseRendererSessionOperation.Logout);
  }

  listModels(): Promise<readonly ManagedProviderCatalogModel[]> {
    if (!this.#started) return Promise.reject(new Error('Enterprise renderer is not connected.'));
    const requestId = crypto.randomUUID();
    const request: EnterpriseRendererModelCatalogRequestMessage = {
      source: EnterpriseRendererMessageSource.Module,
      apiVersion: 1,
      type: EnterpriseRendererMessageType.ModelCatalogRequest,
      requestId,
    };

    return new Promise<EnterpriseRendererModelCatalogResult>((resolve, reject) => {
      const timeout = this.#requestTimeout(requestId, reject);
      this.#pending.set(requestId, {
        kind: PendingRequestKind.ModelCatalog,
        resolve,
        reject,
        timeout,
      });
      window.parent.postMessage(request, '*');
    }).then(result => {
      if (!result.ok) throw new Error('Enterprise model catalog is unavailable.');
      return result.models;
    });
  }

  #request(
    operation: EnterpriseRendererSessionOperation,
    input?: EnterprisePasswordLoginInput | EnterprisePasswordChangeInput,
  ): Promise<EnterpriseSessionResult> {
    if (!this.#started) return Promise.reject(new Error('Enterprise renderer is not connected.'));
    const requestId = crypto.randomUUID();
    const request = {
      source: EnterpriseRendererMessageSource.Module,
      apiVersion: 1,
      type: EnterpriseRendererMessageType.SessionRequest,
      requestId,
      operation,
      ...(input ? { input } : {}),
    } as EnterpriseRendererSessionRequestMessage;

    return new Promise<EnterpriseSessionResult>((resolve, reject) => {
      const timeout = this.#requestTimeout(requestId, reject);
      this.#pending.set(requestId, {
        kind: PendingRequestKind.Session,
        resolve,
        reject,
        timeout,
      });
      window.parent.postMessage(request, '*');
    });
  }

  #requestTimeout(requestId: string, reject: RequestLifecycle['reject']): number {
    return window.setTimeout(() => {
      this.#pending.delete(requestId);
      reject(new Error('Enterprise renderer request timed out.'));
    }, REQUEST_TIMEOUT_MS);
  }

  readonly #handleMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== window.parent) return;
    const message = asRecord(event.data);
    if (message?.source !== EnterpriseRendererMessageSource.Host || message.apiVersion !== 1) {
      return;
    }
    if (message.type === EnterpriseRendererMessageType.Initialize) {
      this.#onInitialize?.(message as unknown as EnterpriseRendererInitializeMessage);
      return;
    }
    if (typeof message.requestId !== 'string') return;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;

    if (
      message.type === EnterpriseRendererMessageType.SessionResponse &&
      pending.kind === PendingRequestKind.Session
    ) {
      if (!isSessionResult(message.result)) return;
      this.#completeRequest(message.requestId, pending);
      pending.resolve((message as unknown as EnterpriseRendererSessionResponseMessage).result);
      return;
    }
    if (
      message.type !== EnterpriseRendererMessageType.ModelCatalogResponse ||
      pending.kind !== PendingRequestKind.ModelCatalog
    ) {
      return;
    }
    const result = parseModelCatalogResult(message.result);
    if (!result) {
      this.#completeRequest(message.requestId, pending);
      pending.reject(new Error('Enterprise model catalog response is invalid.'));
      return;
    }
    this.#completeRequest(message.requestId, pending);
    pending.resolve(result);
  };

  #completeRequest(requestId: string, pending: RequestLifecycle): void {
    this.#pending.delete(requestId);
    window.clearTimeout(pending.timeout);
  }
}

function isSessionResult(value: unknown): value is EnterpriseSessionResult {
  const result = asRecord(value);
  return result?.ok === true ? asRecord(result.snapshot) !== null : result?.ok === false;
}

function parseModelCatalogResult(value: unknown): EnterpriseRendererModelCatalogResult | null {
  const result = asRecord(value);
  if (result?.ok === false) return Object.freeze({ ok: false });
  if (result?.ok !== true || !Array.isArray(result.models) || result.models.length > MAX_MODELS) {
    return null;
  }
  const models: ManagedProviderCatalogModel[] = [];
  const modelRefs = new Set<string>();
  for (const value of result.models) {
    const model = parseManagedModel(value);
    if (!model) return null;
    const modelRef = `${model.providerKey}/${model.id}`;
    if (modelRefs.has(modelRef)) return null;
    modelRefs.add(modelRef);
    models.push(model);
  }
  return Object.freeze({ ok: true, models: Object.freeze(models) });
}

function parseManagedModel(value: unknown): ManagedProviderCatalogModel | null {
  const model = asRecord(value);
  if (
    !isBoundedString(model?.id, 256) ||
    !isBoundedString(model.displayName, 128) ||
    !isBoundedString(model.providerKey, 64) ||
    !isBoundedString(model.providerDisplayName, 128) ||
    (model.contextWindow !== undefined && !isPositiveInteger(model.contextWindow)) ||
    typeof model.isDefault !== 'boolean'
  ) {
    return null;
  }
  const capabilities = parseCapabilities(model.capabilities);
  if (model.capabilities !== undefined && !capabilities) return null;
  return Object.freeze({
    id: model.id,
    displayName: model.displayName,
    providerKey: model.providerKey,
    providerDisplayName: model.providerDisplayName,
    ...(capabilities ? { capabilities } : {}),
    ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
    isDefault: model.isDefault,
  }) as ManagedProviderCatalogModel;
}

function parseCapabilities(value: unknown): Partial<ModelCapabilities> | null {
  if (value === undefined) return Object.freeze({});
  const record = asRecord(value);
  if (!record) return null;
  const parsed: {
    -readonly [Key in keyof ModelCapabilities]?: ModelCapabilities[Key];
  } = {};
  for (const key of Object.keys(record) as Array<keyof ModelCapabilities>) {
    if (!isModelCapabilityKey(key) || !isModelCapabilityStatus(record[key])) return null;
    parsed[key] = record[key];
  }
  return Object.freeze(parsed);
}

function isModelCapabilityKey(value: string): value is keyof ModelCapabilities {
  return [
    'toolCalling',
    'imageInput',
    'videoInput',
    'audioInput',
    'documentInput',
    'reasoning',
  ].includes(value);
}

function isModelCapabilityStatus(
  value: unknown,
): value is ModelCapabilities[keyof ModelCapabilities] {
  return Object.values(ModelCapabilityStatus).includes(
    value as ModelCapabilities[keyof ModelCapabilities],
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
