import type { OllamaProviderSnapshot } from './ollamaProviderBinding';
import type { MagpieHostProvider } from './hostProviders';
import type { ZhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import type { LlamaCppRunningModelBinding } from '../libs/llamacppAgentBinding';
export const LOCAL_GPU_MAGPIE_PROVIDER_ID = 'zhiyuan-host-local-gpu';
export const OLLAMA_MAGPIE_PROVIDER_ID = 'zhiyuan-host-ollama';
export interface LocalGpuSnapshot {
  baseUrl: string | null;
  models: readonly LlamaCppRunningModelBinding[];
}
/** One full source set prevents one managed backend from disabling another's providers. */
export class ManagedMagpieProviderBindings {
  private gpu: MagpieHostProvider | null = null;
  private ollama: MagpieHostProvider | null = null;
  private refreshOllama?: () => Promise<OllamaProviderSnapshot>;
  private gpuRevision = 0;
  private ollamaRevision = 0;
  private refreshGpu?: () => Promise<LocalGpuSnapshot>;
  constructor(
    private readonly enterprise: ZhiyuanManagedProviderBridge,
    private readonly sink: {
      syncHostProviders(providers: readonly MagpieHostProvider[]): Promise<void>;
    },
  ) {}
  setGpuReader(reader: () => Promise<LocalGpuSnapshot>): void {
    this.refreshGpu = reader;
  }
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
        contextWindow: model.contextWindow ?? model.contextTokens,
        maxTokens: model.maxTokens,
        input: ['text'],
      })),
    };
  }
  setOllamaReader(reader: () => Promise<OllamaProviderSnapshot>): void {
    this.refreshOllama = reader;
  }
  setOllamaSnapshot(snapshot: OllamaProviderSnapshot): void {
    this.ollamaRevision++;
    this.ollama = null;
    if (!snapshot.baseUrl || snapshot.models.length === 0) return;
    if (snapshot.baseUrl !== 'http://127.0.0.1:11434/v1')
      throw new Error('Ollama host endpoint must match the owned loopback client');
    this.ollama = {
      id: OLLAMA_MAGPIE_PROVIDER_ID,
      name: 'Ollama',
      api: 'openai-completions',
      baseUrl: snapshot.baseUrl,
      models: snapshot.models,
    };
  }
  async beforeCatalog(): Promise<void> {
    if (this.refreshGpu) {
      const revision = this.gpuRevision;
      try {
        const snapshot = await this.refreshGpu();
        if (revision === this.gpuRevision) this.setGpuSnapshot(snapshot.baseUrl, snapshot.models);
      } catch {
        if (revision === this.gpuRevision) this.gpu = null;
      }
    }
    if (this.refreshOllama) {
      const revision = this.ollamaRevision;
      try {
        const snapshot = await this.refreshOllama();
        if (revision === this.ollamaRevision) this.setOllamaSnapshot(snapshot);
      } catch {
        if (revision === this.ollamaRevision) this.ollama = null;
      }
    }
    await this.synchronize();
  }
  async synchronize(): Promise<void> {
    await this.sink.syncHostProviders([
      ...this.enterprise.hostProviders(),
      ...(this.gpu ? [this.gpu] : []),
      ...(this.ollama ? [this.ollama] : []),
    ]);
  }
  allowedModel(modelRef: string): boolean {
    return this.enterprise.allowedModel(modelRef);
  }
}
