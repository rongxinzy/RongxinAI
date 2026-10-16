import type { MagpieModel, MagpieModelCatalog, MagpieStatus } from '../../shared/magpie/types';

/** Loopback credential the runtime presents to the owned gateway. The gateway, not this process, holds upstream keys. */
export const MAGPIE_RUNTIME_API_KEY = 'magpie-zhiyuan';

export interface MagpieModelBackend {
  status(): MagpieStatus;
  ensureRunning?(): Promise<MagpieStatus>;
  models(): Promise<MagpieModel[]>;
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
  ) {}

  /** Last catalog projection, for synchronous capability reads between turns. */
  peekModel(modelId: string): MagpieModel | undefined {
    return this.latestModels.find(model => model.id === modelId);
  }
  async catalog(): Promise<MagpieModelCatalog> {
    const status = this.backend.status();
    if (status.state !== 'running')
      return { status, models: [], defaultModelId: this.options.readDefaultModelId() || null };
    await this.options.beforeCatalog?.();
    const models = (await this.backend.models()).filter(
      model => this.options.allowedModel?.(model) ?? true,
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
    const model = catalog.models.find(candidate => candidate.id === id);
    if (!model)
      throw new Error(
        'The selected model is no longer available or is restricted. Choose a model in model settings.',
      );
    return { model, catalog, gatewayUrl: catalog.status.gatewayUrl };
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
