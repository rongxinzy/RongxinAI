import { MagpieModelService, installMagpieModelService } from '../../src/main/magpie/modelService';
import type { MagpieModel } from '../../src/shared/magpie/types';

export const TEST_MAGPIE_GATEWAY = 'http://127.0.0.1:1234';

export interface TestMagpieGateway {
  readonly gatewayUrl: string;
  defaultModelId: string;
  upsert(id: string, patch?: Partial<MagpieModel>): MagpieModel;
  setImage(id: string, supported: boolean | 'unknown'): void;
  dispose(): void;
}

/** In-memory gateway catalog so Pi sessions resolve without the legacy provider store. */
export function installTestMagpie(options?: {
  gatewayUrl?: string;
  defaultModelId?: string;
  acceptUnknownModels?: boolean;
}): TestMagpieGateway {
  const models = new Map<string, MagpieModel>();
  const gatewayUrl = options?.gatewayUrl ?? TEST_MAGPIE_GATEWAY;
  let defaultModelId = options?.defaultModelId ?? 'qwen-local';
  const acceptUnknown = options?.acceptUnknownModels !== false;

  const upsert = (id: string, patch?: Partial<MagpieModel>): MagpieModel => {
    const next: MagpieModel = {
      display_name: id,
      context_window: 32768,
      max_output_tokens: 4096,
      ...models.get(id),
      ...patch,
      id,
    };
    models.set(id, next);
    return next;
  };
  upsert(defaultModelId);

  const service = new MagpieModelService(
    {
      status: () => ({ state: 'running', version: 'test', gatewayUrl }),
      ensureRunning: async () => ({ state: 'running', version: 'test', gatewayUrl }),
      models: async () => [...models.values()],
    },
    {
      readDefaultModelId: () => defaultModelId,
      writeDefaultModelId: id => {
        defaultModelId = id;
      },
    },
  );
  const resolve = service.resolve.bind(service);
  service.resolve = async (modelRef?: string) => {
    const id = modelRef?.trim() || defaultModelId;
    if (acceptUnknown && id && !models.has(id)) {
      if (id.startsWith('openai/')) {
        upsert(id, {
          context_window: 272000,
          max_output_tokens: 16384,
          modalities: { input: ['text', 'image'], output: ['text'] },
        });
      } else if (id.startsWith('moonshot/')) {
        upsert(id, {
          context_window: 262144,
          max_output_tokens: 32768,
          modalities: { input: ['text', 'image'], output: ['text'] },
        });
      } else {
        upsert(id);
      }
    }
    return resolve(modelRef);
  };

  const dispose = installMagpieModelService(service);
  return {
    gatewayUrl,
    get defaultModelId() {
      return defaultModelId;
    },
    set defaultModelId(id: string) {
      if (!models.has(id)) upsert(id);
      defaultModelId = id;
    },
    upsert,
    setImage(id, supported) {
      const current = models.get(id) ?? upsert(id);
      if (supported === 'unknown') {
        const { modalities: _modalities, ...rest } = current;
        models.set(id, rest);
        return;
      }
      models.set(id, {
        ...current,
        modalities: {
          input: supported ? ['text', 'image'] : ['text'],
          output: ['text'],
        },
      });
    },
    dispose,
  };
}
