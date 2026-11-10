import { AISphere, AISphereError, AISphereStatus } from '../../../shared/aisphere';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { t } from '../../i18n';
import { MagpieModelService } from '../../magpie/modelService';
import type { AISphereService } from './service';

export function createAISphereModelService(service: AISphereService): MagpieModelService {
  return new MagpieModelService(
    {
      status: () => {
        const gatewayUrl = service.modelGatewayOrigin();
        const ready = service.snapshot().status === AISphereStatus.Ready && Boolean(gatewayUrl);
        return {
          state: ready ? 'running' : 'stopped',
          version: '',
          enabled: true,
          ...(ready ? { gatewayUrl } : {}),
        };
      },
      models: async () =>
        service.snapshot().models.map(model => ({
          id: model.id,
          display_name: model.name,
          owned_by: AISphere.Provider,
          native_endpoints: [AISphere.ChatPath],
          context_window: model.contextWindow,
          max_output_tokens: model.maxTokens,
          reasoning: model.capabilities.reasoning === ModelCapabilityStatus.Supported,
          modalities: {
            input:
              model.capabilities.imageInput === ModelCapabilityStatus.Supported
                ? ['text', 'image']
                : ['text'],
            output: ['text'],
          },
        })),
      ensureRunning: async function () {
        const snapshot = service.snapshot();
        if (snapshot.status === AISphereStatus.Unconfigured) {
          throw new Error(t('aisphereNotConfigured'));
        }
        if (snapshot.status !== AISphereStatus.Ready) {
          await service.refresh().catch(() => {
            throw new Error(t(AISphereError.Unavailable));
          });
        }
        return this.status();
      },
      runtimeApiKey: () => service.token,
    },
    {
      readDefaultModelId: () => service.defaultModel(),
      writeDefaultModelId: model => service.setDefaultModel(model),
    },
  );
}
