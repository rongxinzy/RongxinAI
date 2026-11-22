import type { MagpieHostProvider } from './hostProviders';
import type { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import type { AISphereService } from '../extensions/aisphere/service';
import type { LlamaCppRunningModelBinding, LocalGpuSnapshot } from '../libs/llamacppAgentBinding';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../shared/magpie/constants';
type LocalGpuProvider = Omit<MagpieHostProvider, 'models'> & {
  models: Array<
    MagpieHostProvider['models'][number] & Pick<LlamaCppRunningModelBinding, 'agentEligibility'>
  >;
};
/** One full source set prevents one managed backend from disabling another's providers. */
export class ManagedMagpieProviderBindings {
  private gpu: LocalGpuProvider | null = null;
  private gpuRevision = 0;
  constructor(
    private readonly enterprise: ZhiyuanManagedProviderBridge,
    private readonly sink: {
      syncHostProviders(
        providers: readonly MagpieHostProvider[],
        owner?: AbortSignal,
      ): Promise<void>;
    },
    private readonly sources: {
      organization?: Pick<AISphereService, 'hostProvider' | 'allowedModel'>;
      enterpriseOrigin?: () => string | undefined;
      readLocalModels?: () => Promise<LocalGpuSnapshot>;
    } = {},
  ) {}
  setGpuSnapshot(baseUrl: string | null, models: readonly LlamaCppRunningModelBinding[]): void {
    this.gpuRevision++;
    this.gpu = null;
    if (!baseUrl || models.length === 0) return;
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Local GPU endpoint must be loopback');
    this.gpu = {
      id: LOCAL_GPU_MAGPIE_PROVIDER_ID,
      name: '本地 GPU',
      api: 'openai-completions',
      baseUrl,
      models: models.map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: ['text'],
        agentEligibility: model.agentEligibility,
      })),
    };
  }
  localGpuEligibility(
    modelId: string,
  ): LlamaCppRunningModelBinding['agentEligibility'] | undefined {
    const prefix = `${LOCAL_GPU_MAGPIE_PROVIDER_ID}/`;
    const id = modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
    return this.gpu?.models.find(model => model.id === id)?.agentEligibility;
  }
  async beforeCatalog(owner?: AbortSignal): Promise<void> {
    const { organization, readLocalModels } = this.sources;
    if (!organization && readLocalModels) {
      const revision = this.gpuRevision;
      try {
        const snapshot = await readLocalModels();
        owner?.throwIfAborted();
        if (revision === this.gpuRevision) this.setGpuSnapshot(snapshot.baseUrl, snapshot.models);
      } catch {
        owner?.throwIfAborted();
        if (revision === this.gpuRevision) this.gpu = null;
      }
    }
    await this.synchronize(owner);
  }
  async synchronize(owner?: AbortSignal): Promise<void> {
    owner?.throwIfAborted();
    const { organization, enterpriseOrigin } = this.sources;
    const providers = organization
      ? [organization.hostProvider()].filter(provider => provider !== null)
      : [...this.enterprise.hostProviders(enterpriseOrigin?.()), ...(this.gpu ? [this.gpu] : [])];
    await this.sink.syncHostProviders(providers, owner);
  }
  allowedModel(modelRef: string, owner?: string): boolean {
    const { organization } = this.sources;
    return organization
      ? organization.allowedModel(modelRef, owner)
      : this.enterprise.allowedModel(modelRef);
  }
}
