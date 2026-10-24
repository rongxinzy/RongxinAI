import type { MagpieRoutingGroup } from '../../shared/magpie/routingUsage';
import type {
  MagpieModel,
  MagpieModelCatalog,
  MagpieProviderSummary,
  MagpieStatus,
} from '../../shared/magpie/types';
import { routingGroupAllowed } from './routingGroupPolicy';
import type { MagpieRoutingUsageService } from './routingUsageService';

/** Loopback credential the runtime presents to the owned gateway. The gateway, not this process, holds upstream keys. */
export const MAGPIE_RUNTIME_API_KEY = 'magpie-zhiyuan';

export interface MagpieModelBackend {
  status(): MagpieStatus;
  ensureRunning?(): Promise<MagpieStatus>;
  models(): Promise<MagpieModel[]>;
  providers?(): Promise<MagpieProviderSummary[]>;
  recordError?(message: string, providerId?: string): void;
}
export interface MagpieModelServiceOptions {
  readDefaultModelId(): string | undefined | null;
  writeDefaultModelId(id: string): void | Promise<void>;
  /** Refresh host-owned enterprise/GPU bindings before reading the single authoritative catalog. */
  beforeCatalog?(): Promise<void>;
  /** Main-owned enterprise policy. Never trust a renderer filter or a routing group's label. */
  allowedModel?(model: MagpieModel): boolean;
}
export class MagpieModelService {
  private latestModels: MagpieModel[] = [];

  constructor(
    private readonly backend: MagpieModelBackend,
    private readonly options: MagpieModelServiceOptions,
    private readonly routingUsage?: MagpieRoutingUsageService,
  ) {}
  recordError(message: string, providerId?: string): void {
    this.backend.recordError?.(message, providerId);
  }

  /** Last catalog projection, for synchronous capability reads between turns. */
  peekModel(modelId: string): MagpieModel | undefined {
    return this.latestModels.find(model => model.id === modelId);
  }
  async catalog(): Promise<MagpieModelCatalog> {
    const status = this.backend.status();
    if (status.state !== 'running')
      return { status, models: [], defaultModelId: this.options.readDefaultModelId() || null };
    await this.options.beforeCatalog?.();
    let groupsById = new Map<string, MagpieRoutingGroup>();
    if (this.routingUsage) {
      try {
        const routing = await this.routingUsage.routingGroups();
        groupsById = new Map(routing.groups.map(group => [group.id, group]));
      } catch {
        /* routing metadata is optional for catalog reads */
      }
    }
    const models = (await this.backend.models()).filter(model =>
      routingGroupAllowed(model, groupsById, this.options.allowedModel),
    );
    this.latestModels = models;
    const current = this.backend.status();
    if (current.state !== 'running' || current.gatewayUrl !== status.gatewayUrl)
      throw new Error('Model service changed while reading its catalog. Try again.');
    return { status: current, models, defaultModelId: this.options.readDefaultModelId() || null };
  }
  async selectDefault(modelId: string): Promise<MagpieModelCatalog> {
    if (typeof modelId !== 'string' || !modelId || modelId.length > 500)
      throw new Error('Invalid model selection');
    const catalog = await this.catalog();
    if (!catalog.models.some(model => model.id === modelId))
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
  async resolve(
    modelRef?: string,
  ): Promise<{ model: MagpieModel; catalog: MagpieModelCatalog; gatewayUrl: string }> {
    await this.backend.ensureRunning?.();
    const catalog = await this.catalog();
    if (catalog.status.state !== 'running' || !catalog.status.gatewayUrl)
      throw new Error('Enable the unified model service in model settings before starting a task.');
    const id = modelRef?.trim() || catalog.defaultModelId;
    if (!id) throw new Error('Choose a default model in model settings before starting a task.');
    let model = catalog.models.find(candidate => candidate.id === id);
    if (!model && this.backend.providers) {
      try {
        const providers = await this.backend.providers();
        const provider = providers.find(p => !p.off && (p.models.includes(id) || p.id === id));
        if (provider && Array.isArray(provider.fallback) && provider.fallback.length > 0) {
          for (const fallbackId of provider.fallback) {
            const candidate = catalog.models.find(m => m.id === fallbackId);
            if (candidate) {
              if (provider.api === 'anthropic-messages') {
                const endpoints = candidate.native_endpoints ?? [];
                if (!endpoints.includes('/v1/messages')) continue;
              }
              model = candidate;
              break;
            }
          }
        }
      } catch {
        /* ignore fallback resolution error */
      }
    }
    if (!model)
      throw new Error(
        'The selected model is no longer available or is restricted. Choose a model in model settings.',
      );
    return { model, catalog, gatewayUrl: catalog.status.gatewayUrl };
  }

  /** Companion requests use existing consent and policy, without changing the global default. */
  async resolveAutomatic(excludedIds: ReadonlySet<string> = new Set()): Promise<{
    model: MagpieModel;
    gatewayUrl: string;
  } | null> {
    const status = this.backend.status();
    if (status.enabled === false) return null;
    if (status.state !== 'running' && status.enabled === true) await this.backend.ensureRunning?.();
    const catalog = await this.catalog();
    if (catalog.status.state !== 'running' || !catalog.status.gatewayUrl) return null;
    const candidates = catalog.models.filter(model => {
      if (excludedIds.has(model.id)) return false;
      // The gateway projects absent capability metadata as empty arrays.
      // Only an explicit non-text declaration excludes a text attempt.
      if (model.modalities?.input.length && !model.modalities.input.includes('text')) return false;
      if (model.modalities?.output.length && !model.modalities.output.includes('text'))
        return false;
      return (
        !model.native_endpoints?.length ||
        model.native_endpoints.some(endpoint =>
          ['/v1/messages', '/v1/responses', '/v1/chat/completions'].includes(endpoint),
        )
      );
    });
    candidates.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const model =
      candidates.find(candidate => candidate.id === catalog.defaultModelId) ?? candidates[0];
    return model ? { model, gatewayUrl: catalog.status.gatewayUrl } : null;
  }
}
let installed: MagpieModelService | undefined;
export function installMagpieModelService(service: MagpieModelService): () => void {
  if (installed) throw new Error('Model service is already registered');
  installed = service;
  return () => {
    if (installed === service) installed = undefined;
  };
}
export function hasMagpieModelService(): boolean {
  return installed !== undefined;
}
export function getMagpieModelService(): MagpieModelService {
  if (!installed) throw new Error('Unified model service is not initialized');
  return installed;
}
