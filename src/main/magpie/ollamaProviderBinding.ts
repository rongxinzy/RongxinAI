import type { OllamaManager } from '../libs/ollamaManager';
import type { MagpieHostProvider } from './hostProviders';
export interface OllamaProviderSnapshot {
  baseUrl: string | null;
  models: MagpieHostProvider['models'];
}
/** The owned Ollama client is fixed to loopback; catalog reads never launch the service. */
export async function readOllamaProviderSnapshot(
  manager: Pick<OllamaManager, 'client'>,
): Promise<OllamaProviderSnapshot> {
  const client = await manager.client();
  const running = await client.runningModels(1500);
  return {
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: running
      .map(model => ({
        id: model.model?.trim() || model.name.trim(),
        name: model.name,
        ...(typeof model.context_length === 'number' && model.context_length > 0
          ? { contextWindow: model.context_length }
          : {}),
        input: ['text' as const],
      }))
      .filter(model => model.id),
  };
}
