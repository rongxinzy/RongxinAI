import { ipcMain, net } from 'electron';

import { ApiIpc } from '../../shared/ipc/channels';
import { ProviderModelDiscoverySchema } from '../../shared/ipc/schemas';
import {
  ProviderModelDiscoveryErrorCode,
  type ProviderModelDiscoveryResult,
} from '../../shared/providers';
import {
  discoverProviderModels,
  ProviderModelDiscoveryError,
} from '../libs/providerModelDiscovery';

export function registerProviderModelDiscoveryIpcHandler(): void {
  ipcMain.handle(ApiIpc.FetchModels, async (_event, rawInput: unknown) => {
    const input = ProviderModelDiscoverySchema.input.parse(rawInput);
    let result: ProviderModelDiscoveryResult;
    try {
      result = {
        success: true,
        models: await discoverProviderModels(input, net.fetch),
      };
    } catch (error) {
      const discoveryError =
        error instanceof ProviderModelDiscoveryError
          ? error
          : new ProviderModelDiscoveryError(
              ProviderModelDiscoveryErrorCode.Network,
              'The model request failed.',
            );
      console.warn('[ProviderModelDiscovery] model discovery failed:', error);
      result = {
        success: false,
        code: discoveryError.code,
        error: discoveryError.message,
      };
    }
    return ProviderModelDiscoverySchema.output.parse(result);
  });
}
