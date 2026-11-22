import { isDeepStrictEqual } from 'node:util';
import type { LlamaCppAgentEligibility } from '../../shared/llamacpp';
import { ModelCapabilityStatus } from '../../shared/providers';
import { t } from '../i18n';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../shared/magpie/constants';
import type { MagpieRoutingGroup } from '../../shared/magpie/routingUsage';
import type {
  MagpieModel,
  MagpieModelCatalog,
  MagpieProviderSummary,
  MagpieStatus,
} from '../../shared/magpie/types';
import {
  assertLlamaCppWorkModeContext,
  assertWorkModeContextWindow,
  isWorkModeContextTooSmall,
} from '../libs/llamacppWorkModeContextGuard';
import {
  collectRoutableGroupModels,
  routingGroupAllowed,
  routingGroupIdForModel,
  workRouteModelId,
} from './routingGroupPolicy';
import type { MagpieRoutingUsageService } from './routingUsageService';
import { ENTERPRISE_HOST_PROVIDER_PREFIX } from './hostProviders';
import { magpieImageInput, supportsMagpieTextConversation } from './catalog';

/** Upper bound above which an unconfigured private/self-hosted model's catalog guess is suspect. */
const UNCONFIGURED_PRIVATE_CATALOG_CONTEXT_SUSPECT_MIN = 500_000;

function isPrivateOrLanBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname) return false;
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan') ||
      !hostname.includes('.')
    ) {
      return true;
    }
    const octets = hostname.split('.').map(part => Number(part));
    if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    const [a, b] = octets;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  } catch {
    return false;
  }
}

/**
 * Prevent cloud-catalog guesses (e.g. 1M for a matching model name) from inflating an
 * unconfigured self-hosted LAN provider that never declared or probed a context window.
 */
function sanitizeCatalogModelsForPrivateProviders(
  models: MagpieModel[],
  providers: readonly MagpieProviderSummary[],
): MagpieModel[] {
  const privateUnconfiguredPrefixes = providers
    .filter(p => !p.off && !p.isHostManaged && isPrivateOrLanBaseUrl(p.baseUrl))
    .map(p => ({
      prefix: `${p.id}/`,
      contexts: p.contexts ?? {},
    }));
  if (privateUnconfiguredPrefixes.length === 0) return models;

  return models.map(model => {
    if (
      model.context_window === undefined ||
      model.context_window < UNCONFIGURED_PRIVATE_CATALOG_CONTEXT_SUSPECT_MIN
    ) {
      return model;
    }
    const owner = privateUnconfiguredPrefixes.find(entry => model.id.startsWith(entry.prefix));
    if (!owner) return model;
    const rawModelId = model.id.slice(owner.prefix.length);
    if (owner.contexts[rawModelId] !== undefined || owner.contexts['*'] !== undefined) {
      return model;
    }
    const { context_window: _dropped, ...rest } = model;
    return rest;
  });
}

/** Shared loopback credential for read-only Chat and Companion inference. */
export const MAGPIE_RUNTIME_API_KEY = 'magpie-zhiyuan';
export const MAGPIE_DEFAULT_MODEL_ID_KEY = 'magpie_default_model_id';
export const MagpieWorkHeader = {
  Workload: 'X-Magpie-Workload',
  Models: 'X-Magpie-Work-Models',
} as const;
export const MAGPIE_ENTERPRISE_CHAT_WORKLOAD = 'enterprise-chat';

type ScopedRequest = {
  key: () => string | undefined;
  models: () => string | undefined;
};

type ModelResolveOptions = { work?: boolean; requirePublishedModel?: boolean };

const MAX_WORK_MODELS = 500;
const MAX_WORK_MODELS_HEADER = 16384;

function encodeWorkModels(models: string[]): string | undefined {
  if (!models.length || models.length > MAX_WORK_MODELS) return;
  // Fetch headers are bytes. Escape Unicode so model IDs survive the wire unchanged.
  const value = JSON.stringify(models).replace(
    /[^\x20-\x7e]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return value.length <= MAX_WORK_MODELS_HEADER ? value : undefined;
}

export interface MagpieModelBackend {
  status(): MagpieStatus;
  catalogOwner?(): AbortSignal | undefined;
  waitForStartup?(): Promise<unknown> | undefined;
  ensureRunning?(): Promise<MagpieStatus>;
  workKeyResolver?(gatewayUrl: string): (() => string | undefined) | undefined;
  recoverIfNeeded?(): Promise<MagpieStatus>;
  models(): Promise<MagpieModel[]>;
  providers?(options: { probeStoredKeys: false }): Promise<MagpieProviderSummary[]>;
  recordError?(message: string, providerId?: string): void;
}
export interface MagpieModelServiceOptions {
  readDefaultModelId(): string | undefined | null;
  writeDefaultModelId(id: string): void | Promise<void>;
  /** Refresh host-owned enterprise/GPU bindings before reading the single authoritative catalog. */
  beforeCatalog?(owner?: AbortSignal): Promise<void>;
  /** Main-owned enterprise policy. Never trust a renderer filter or a routing group's label. */
  allowedModel?(model: MagpieModel): boolean;
  allowProviderFallback?: boolean;
  readLocalGpuEligibility?(modelId: string): LlamaCppAgentEligibility | undefined;
}

type CatalogOwner = { gatewayUrl: string | undefined; signal: AbortSignal | undefined };
type CatalogRead = {
  catalog: MagpieModelCatalog;
  modelsById: ReadonlyMap<string, MagpieModel>;
  groupsById: Map<string, MagpieRoutingGroup>;
  publishedModels: MagpieModel[];
  providers: MagpieProviderSummary[];
  owner: CatalogOwner;
};

function providerForModel(providers: MagpieProviderSummary[], model: MagpieModel) {
  const qualifiedId = model.canonical_id ?? model.id;
  const owner =
    model.owned_by ?? (qualifiedId.includes('/') ? qualifiedId.split('/', 1)[0] : undefined);
  if (owner) return providers.find(provider => !provider.off && provider.id === owner);
  return (
    providers.find(provider => !provider.off && provider.models.includes(model.id)) ??
    providers.find(provider => !provider.off && provider.fallback?.includes(model.id))
  );
}

export class MagpieModelService {
  private latest?: CatalogRead & { revision: number };
  private readRevision = 0;
  private invalidatedRevision = 0;

  constructor(
    private readonly backend: MagpieModelBackend,
    private readonly options: MagpieModelServiceOptions,
    private readonly routingUsage?: MagpieRoutingUsageService,
  ) {}
  recordError(message: string, providerId?: string): void {
    this.backend.recordError?.(message, providerId);
  }
  recoverIfNeeded(): Promise<MagpieStatus | undefined> {
    return this.backend.recoverIfNeeded?.() ?? Promise.resolve(undefined);
  }

  private ownsCatalog(owner: CatalogOwner, status?: MagpieStatus): boolean {
    if (owner.signal?.aborted || owner.signal !== this.backend.catalogOwner?.()) return false;
    // The production backend only exposes an owner for its running process.
    if (!status && owner.signal) return true;
    const current = status ?? this.backend.status();
    return current.state === 'running' && current.gatewayUrl === owner.gatewayUrl;
  }
  async catalog(): Promise<MagpieModelCatalog> {
    return (await this.catalogAndRoutes()).catalog;
  }

  invalidateCatalog(): void {
    this.invalidatedRevision = this.readRevision;
    this.latest = undefined;
  }

  private async catalogAndRoutes(): Promise<CatalogRead> {
    const groupsById = new Map<string, MagpieRoutingGroup>();
    let status = this.backend.status();
    if (status.state === 'starting' && this.backend.waitForStartup) {
      await this.backend.waitForStartup();
      status = this.backend.status();
    }
    const owner = { gatewayUrl: status.gatewayUrl, signal: this.backend.catalogOwner?.() };
    if (status.state !== 'running')
      return {
        groupsById,
        modelsById: new Map(),
        publishedModels: [],
        providers: [],
        owner,
        catalog: { status, models: [], defaultModelId: this.options.readDefaultModelId() || null },
      };
    const revision = ++this.readRevision;
    await this.options.beforeCatalog?.(owner.signal);
    if (!this.ownsCatalog(owner))
      throw new Error('Model service changed while reading its catalog. Try again.');
    if (this.routingUsage) {
      try {
        const routing = await this.routingUsage.routingGroups();
        for (const group of routing.groups) groupsById.set(group.id, group);
      } catch {
        /* routing metadata is optional for catalog reads */
      }
    }
    const publishedModels = await this.backend.models();
    const allowedModels = publishedModels.filter(model =>
      routingGroupAllowed(model, groupsById, this.options.allowedModel),
    );
    let providers: MagpieProviderSummary[] = [];
    if (this.backend.providers) {
      try {
        providers = await this.backend.providers({ probeStoredKeys: false });
      } catch {
        /* provider metadata is optional for catalog reads */
      }
    }
    const models = sanitizeCatalogModelsForPrivateProviders(allowedModels, providers);
    const current = this.backend.status();
    if (!this.ownsCatalog(owner, current))
      throw new Error('Model service changed while reading its catalog. Try again.');
    if (revision <= this.invalidatedRevision) return this.catalogAndRoutes();
    if (
      this.latest &&
      revision < this.latest.revision &&
      this.ownsCatalog(this.latest.owner, current)
    ) {
      return {
        ...this.latest,
        catalog: {
          ...this.latest.catalog,
          status: current,
          defaultModelId: this.options.readDefaultModelId() || null,
        },
      };
    }
    const snapshot = {
      revision,
      groupsById,
      modelsById: new Map(models.map(model => [model.id, model])),
      publishedModels,
      providers,
      owner,
      catalog: {
        status: current,
        models,
        defaultModelId: this.options.readDefaultModelId() || null,
      },
    };
    this.latest = snapshot;
    return snapshot;
  }
  async selectDefault(modelId: string): Promise<MagpieModelCatalog> {
    if (typeof modelId !== 'string' || !modelId || modelId.length > 500)
      throw new Error('Invalid model selection');
    const { catalog, owner, modelsById } = await this.catalogAndRoutes();
    if (catalog.status.state === 'running' && !this.ownsCatalog(owner))
      throw new Error('Model service changed while reading its catalog. Try again.');
    if (!modelsById.has(modelId))
      throw new Error('The selected model is unavailable. Refresh the model list.');
    await this.options.writeDefaultModelId(modelId);
    return { ...catalog, defaultModelId: modelId };
  }
  async checkReadiness(): Promise<{ hasConfig: boolean; config: null; error?: string }> {
    try {
      await this.resolve();
      return { hasConfig: true, config: null };
    } catch (error) {
      return {
        hasConfig: false,
        config: null,
        error: error instanceof Error ? error.message : 'The model service is unavailable.',
      };
    }
  }
  async resolve(modelRef?: string, options?: ModelResolveOptions) {
    await this.backend.ensureRunning?.();
    return this.resolveFromCatalog(await this.catalogAndRoutes(), modelRef, options);
  }

  private resolveFromCatalog(
    snapshot: CatalogRead,
    modelRef?: string,
    { work = false, requirePublishedModel = false }: ModelResolveOptions = {},
  ): {
    model: MagpieModel;
    gatewayModel: MagpieModel;
    catalog: MagpieModelCatalog;
    gatewayUrl: string;
    isCurrentGateway: () => boolean;
    isCurrentRoute: () => boolean;
    provider?: MagpieProviderSummary;
    routingGroupId?: string;
    workRequest?: ScopedRequest;
    enterpriseChatRequest?: ScopedRequest;
  } {
    const { catalog, modelsById, groupsById, publishedModels, providers, owner } = snapshot;
    if (catalog.status.state !== 'running' || !catalog.status.gatewayUrl)
      throw new Error('Enable the unified model service in model settings before starting a task.');
    if (!this.ownsCatalog(owner))
      throw new Error('Model service changed while reading its catalog. Try again.');
    const gatewayUrl = catalog.status.gatewayUrl;
    const id = modelRef?.trim() || catalog.defaultModelId;
    if (!id) throw new Error('Choose a default model in model settings before starting a task.');
    const model = modelsById.get(id);
    if (!model && !requirePublishedModel && this.options.allowProviderFallback !== false) {
      const qualified = providers.find(provider => id.startsWith(`${provider.id}/`));
      const provider =
        qualified ??
        providers.find(
          candidate => !candidate.off && (candidate.models.includes(id) || candidate.id === id),
        );
      const fallbackIds =
        !provider ||
        provider.off ||
        (qualified && !qualified.models.includes(id.slice(qualified.id.length + 1)))
          ? []
          : (provider.fallback ?? []);
      let rejected: unknown;
      for (const fallbackId of fallbackIds) {
        if (!modelsById.has(fallbackId)) continue;
        try {
          const fallback = this.resolveFromCatalog(snapshot, fallbackId, {
            work,
            requirePublishedModel: true,
          });
          if (
            provider?.api === 'anthropic-messages' &&
            !fallback.gatewayModel.native_endpoints?.includes('/v1/messages')
          )
            continue;
          if (work && (!fallback.workRequest?.key() || !fallback.workRequest.models())) continue;
          return {
            ...fallback,
            isCurrentRoute: () => {
              const latest = this.latest;
              if (!latest || !fallback.isCurrentRoute()) return false;
              try {
                // A live fallback can stop being the route for the original selection.
                return (
                  this.resolveFromCatalog(latest, id, { work }).gatewayModel.id ===
                  fallback.gatewayModel.id
                );
              } catch {
                return false;
              }
            },
          };
        } catch (error) {
          rejected ??= error;
        }
      }
      if (rejected) throw rejected;
    }
    const gatewayId = work && model ? workRouteModelId(model, groupsById) : undefined;
    const gatewayModel = work ? gatewayId && modelsById.get(gatewayId) : model;
    if (!model || !gatewayModel)
      throw new Error(
        'The selected model is no longer available or is restricted. Choose a model in model settings.',
      );
    if (!supportsMagpieTextConversation(gatewayModel)) {
      throw new Error(t('coworkErrorModelTextUnsupported'));
    }
    const canonicalId = gatewayModel.canonical_id ?? gatewayModel.id;
    const groupId = routingGroupIdForModel(canonicalId, groupsById);
    const provider = groupId === undefined ? providerForModel(providers, gatewayModel) : undefined;
    const selectionId = model.id;
    const isCurrentGateway = () => this.ownsCatalog(owner);
    const isCurrentRoute = () => {
      const latest = this.latest;
      if (!latest || !isCurrentGateway()) return false;
      if (work) {
        const selection = latest.modelsById.get(selectionId);
        if (!selection || workRouteModelId(selection, latest.groupsById) !== gatewayModel.id)
          return false;
      }
      const current = latest.modelsById.get(gatewayModel.id);
      if (!current || !isDeepStrictEqual(current, gatewayModel)) return false;
      const currentGroupId = routingGroupIdForModel(canonicalId, latest.groupsById);
      const currentProvider =
        currentGroupId === undefined ? providerForModel(latest.providers, current) : undefined;
      return (
        currentGroupId === groupId &&
        currentProvider?.id === provider?.id &&
        currentProvider?.baseUrl === provider?.baseUrl &&
        currentProvider?.api === provider?.api
      );
    };
    const groupModels =
      groupId === undefined ? null : collectRoutableGroupModels(groupId, groupsById);
    const localPrefix = `${LOCAL_GPU_MAGPIE_PROVIDER_ID}/`;
    if (work) {
      const candidates =
        groupId === undefined
          ? [canonicalId]
          : (groupModels ?? publishedModels.map(candidate => candidate.id));
      for (const candidate of candidates) {
        if (candidate.startsWith(localPrefix)) {
          assertLlamaCppWorkModeContext(this.options.readLocalGpuEligibility?.(candidate) ?? null);
        }
      }
      assertWorkModeContextWindow({
        modelId: gatewayModel.id,
        contextWindow: gatewayModel.context_window,
      });
    }

    const enterpriseChat =
      !work &&
      (groupId === undefined
        ? canonicalId.startsWith(ENTERPRISE_HOST_PROVIDER_PREFIX)
        : [...(groupModels ?? [])].some(id => id.startsWith(ENTERPRISE_HOST_PROVIDER_PREFIX)));
    const workKey = work ? this.backend.workKeyResolver?.(gatewayUrl) : undefined;
    let enterpriseChatRequest: ScopedRequest | undefined;
    if (enterpriseChat) {
      const key = this.backend.workKeyResolver?.(gatewayUrl);
      const candidates = groupId === undefined ? [canonicalId] : [...(groupModels ?? [])];
      if (!key?.() || !encodeWorkModels(candidates)) {
        throw new Error('The managed model route does not have an authorized desktop scope.');
      }
      enterpriseChatRequest = {
        key,
        models: () => {
          const latest = this.latest;
          if (!latest || !isCurrentRoute()) return;
          const published =
            groupId === undefined
              ? [canonicalId]
              : collectRoutableGroupModels(groupId, latest.groupsById);
          return encodeWorkModels(
            [...(published ?? [])].filter(
              id =>
                this.options.allowedModel?.(
                  latest.modelsById.get(id) ?? { id, owned_by: id.split('/')[0] },
                ) !== false,
            ),
          );
        },
      };
    }
    let workRequest: ScopedRequest | undefined;
    if (workKey && (groupId === undefined || groupModels)) {
      workRequest = {
        key: workKey,
        models: () => {
          const latest = this.latest;
          if (!latest || !isCurrentRoute()) return;
          return this.workModelScope(latest, gatewayModel, canonicalId, groupId);
        },
      };
    }
    return {
      model,
      gatewayModel,
      catalog,
      gatewayUrl: catalog.status.gatewayUrl,
      isCurrentGateway,
      isCurrentRoute,
      provider,
      routingGroupId: groupId,
      workRequest,
      enterpriseChatRequest,
    };
  }

  private workModelScope(
    { modelsById, groupsById, providers }: CatalogRead,
    gatewayModel: MagpieModel,
    canonicalId: string,
    groupId: string | undefined,
  ): string | undefined {
    const provider = groupId === undefined ? providerForModel(providers, gatewayModel) : undefined;
    const fallbacks =
      provider && canonicalId.startsWith(`${provider.id}/`) ? (provider.fallback ?? []) : [];
    const candidates =
      groupId === undefined
        ? new Set([
            canonicalId,
            ...fallbacks.flatMap(id => {
              const model = modelsById.get(id);
              const canonical = model && workRouteModelId(model, groupsById);
              return canonical && modelsById.has(canonical) ? [canonical] : [];
            }),
          ])
        : collectRoutableGroupModels(groupId, groupsById);
    const localPrefix = `${LOCAL_GPU_MAGPIE_PROVIDER_ID}/`;
    return encodeWorkModels(
      [...(candidates ?? [])].filter(id => {
        if (routingGroupIdForModel(id, groupsById) !== undefined) return false;
        const model = modelsById.get(id) ?? { id, owned_by: id.split('/')[0] };
        return (
          supportsMagpieTextConversation(model) &&
          !isWorkModeContextTooSmall(model.context_window) &&
          this.options.allowedModel?.(model) !== false &&
          (!id.startsWith(localPrefix) ||
            this.options.readLocalGpuEligibility?.(id)?.eligible === true)
        );
      }),
    );
  }

  /** Companion requests use existing consent and policy, without changing the global default. */
  async resolveAutomatic(
    excludedIds: ReadonlySet<string> = new Set(),
    requirements: { imageInput?: boolean; work?: boolean } = {},
  ): Promise<{
    modelId: string;
    imageInput: boolean;
  } | null> {
    const status = this.backend.status();
    if (status.enabled === false) return null;
    if (status.state !== 'running' && status.enabled === true) await this.backend.ensureRunning?.();
    const snapshot = await this.catalogAndRoutes();
    const { catalog, owner } = snapshot;
    if (!catalog.status.gatewayUrl || !this.ownsCatalog(owner)) return null;
    const candidates = catalog.models.filter(model => !excludedIds.has(model.id));
    candidates.sort(
      (a, b) =>
        Number(b.id === catalog.defaultModelId) - Number(a.id === catalog.defaultModelId) ||
        a.id.localeCompare(b.id, 'en'),
    );
    for (const candidate of candidates) {
      try {
        const { gatewayModel, workRequest, enterpriseChatRequest } = this.resolveFromCatalog(
          snapshot,
          candidate.id,
          { work: requirements.work, requirePublishedModel: true },
        );
        const imageInput = magpieImageInput(gatewayModel) === ModelCapabilityStatus.Supported;
        if (requirements.imageInput && !imageInput) continue;
        const scope = requirements.work ? workRequest : enterpriseChatRequest;
        if (scope ? scope.key() && scope.models() : !requirements.work) {
          return { modelId: candidate.id, imageInput };
        }
      } catch {
        // Continue to the next eligible route in catalog order.
      }
    }
    return null;
  }
}
