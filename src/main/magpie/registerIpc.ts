import { ipcMain } from 'electron';
import {
  MagpieIpc,
  type MagpieModelSelection,
  type MagpieSaveProviderInput,
} from '../../shared/magpie/types';
import type { MagpiePreferencesPatch } from '../../shared/magpie/preferences';
import type { MagpieManager } from './manager';
import type { MagpieModelService } from './modelService';
import { HOST_PROVIDER_PREFIX } from './hostProviders';

/** The app supplies its existing trusted-main-frame predicate. No arbitrary URL/HTTP IPC. */
export function registerMagpieIpc(
  manager: MagpieManager,
  trusted: (event: Electron.IpcMainInvokeEvent) => boolean,
  models?: MagpieModelService,
): () => Promise<void> {
  const handle = (channel: string, handler: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted model management request');
      return handler(...args);
    });
  };
  handle(MagpieIpc.catalog, () => {
    if (!models) throw new Error('Model catalog is not initialized');
    return models.catalog();
  });
  handle(MagpieIpc.selectDefault, (id: string) => {
    if (!models) throw new Error('Model catalog is not initialized');
    return models.selectDefault(id);
  });
  handle(MagpieIpc.setSubscriptionAccounts, (enabled: boolean) =>
    manager.setSubscriptionAccounts(enabled),
  );
  handle(MagpieIpc.status, () => manager.status());
  handle(MagpieIpc.start, () => manager.start());
  handle(MagpieIpc.stop, () => manager.stop());
  handle(MagpieIpc.models, () => manager.models());
  handle(MagpieIpc.agents, () => manager.agents());
  handle(MagpieIpc.setModel, (selection: MagpieModelSelection) => manager.setModel(selection));
  handle(MagpieIpc.previewAgent, (agentId: string) => manager.previewAgent(agentId));
  handle(MagpieIpc.connectAgent, (agentId: string) => manager.connectAgent(agentId));
  handle(MagpieIpc.disconnectAgent, (agentId: string) => manager.disconnectAgent(agentId));
  handle(MagpieIpc.disconnectAllAgents, () => manager.disconnectAllAgents());
  handle(MagpieIpc.providers, () => manager.providers());
  handle(MagpieIpc.saveProvider, (input: MagpieSaveProviderInput) => {
    if (input?.id && typeof input.id === 'string' && input.id.startsWith(HOST_PROVIDER_PREFIX)) {
      throw new Error('Host-managed providers cannot be modified via user settings');
    }
    return manager.saveProvider(input);
  });
  handle(MagpieIpc.setProviderEnabled, (id: string, enabled: boolean) => {
    if (typeof id === 'string' && id.startsWith(HOST_PROVIDER_PREFIX)) {
      throw new Error('Host-managed providers cannot be toggled via user settings');
    }
    return manager.setProviderEnabled(id, enabled);
  });
  handle(MagpieIpc.deleteProvider, (id: string) => {
    if (typeof id === 'string' && id.startsWith(HOST_PROVIDER_PREFIX)) {
      throw new Error('Host-managed providers cannot be deleted via user settings');
    }
    return manager.deleteProvider(id);
  });
  handle(MagpieIpc.testProvider, (input: MagpieSaveProviderInput) => manager.testProvider(input));
  handle(MagpieIpc.diagnostics, () => manager.diagnostics());
  handle(MagpieIpc.preferences, () => manager.preferences());
  handle(MagpieIpc.updatePreferences, (patch: MagpiePreferencesPatch) =>
    manager.updatePreferences(patch),
  );
  return async () => {
    for (const channel of Object.values(MagpieIpc)) ipcMain.removeHandler(channel);
    await manager.shutdown();
  };
}
