import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import { MagpieIpc } from '../../shared/magpie/types';
import { providersContract } from '../../shared/ipc/providersContract';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import type { MagpieManager } from './manager';
import type { MagpieModelService } from './modelService';
import type { MagpieRoutingUsageService } from './routingUsageService';
import { HOST_PROVIDER_PREFIX } from './hostProviders';

/** The app supplies its existing trusted-main-frame predicate. No arbitrary URL/HTTP IPC. */
export function registerMagpieIpc(
  manager: MagpieManager,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  models?: MagpieModelService,
  routingUsage?: MagpieRoutingUsageService,
): () => Promise<void> {
  const usage = routingUsage ?? manager.routingUsage;
  // All magpie channels share one trust gate (main-frame sender only); apply
  // it around each impl so the contract layer keeps its arg validation.
  const gated =
    <A extends unknown[], R>(
      handler: (event: IpcMainInvokeEvent, ...args: A) => R,
    ): ((event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted model management request');
      return handler(event, ...args);
    };

  handleIpcContractSubset(providersContract, {
    magpieCatalog: gated(() => {
      if (!models) throw new Error('Model catalog is not initialized');
      return models.catalog();
    }),
    magpieSelectDefault: gated((_event, id) => {
      if (!models) throw new Error('Model catalog is not initialized');
      return models.selectDefault(id);
    }),
    magpieSetSubscriptionAccounts: gated((_event, enabled) =>
      manager.setSubscriptionAccounts(enabled),
    ),
    magpieStatus: gated(() => manager.status()),
    magpieStart: gated(() => manager.start()),
    magpieStop: gated(() => manager.stop()),
    magpieModels: gated(() => manager.models()),
    magpieAgents: gated(() => manager.agents()),
    magpieSetModel: gated((_event, selection) => manager.setModel(selection)),
    magpiePreviewAgent: gated((_event, agentId) => manager.previewAgent(agentId)),
    magpieConnectAgent: gated((_event, agentId) => manager.connectAgent(agentId)),
    magpieDisconnectAgent: gated((_event, agentId) => manager.disconnectAgent(agentId)),
    magpieDisconnectAllAgents: gated(() => manager.disconnectAllAgents()),
    magpieProviders: gated(() => manager.providers()),
    magpieSaveProvider: gated((_event, input) => {
      if (input?.id?.startsWith(HOST_PROVIDER_PREFIX)) {
        throw new Error('Host-managed providers cannot be modified via user settings');
      }
      return manager.saveProvider(input);
    }),
    magpieSetProviderEnabled: gated((_event, id, enabled) => {
      if (id.startsWith(HOST_PROVIDER_PREFIX)) {
        throw new Error('Host-managed providers cannot be toggled via user settings');
      }
      return manager.setProviderEnabled(id, enabled);
    }),
    magpieDeleteProvider: gated((_event, id) => {
      if (id.startsWith(HOST_PROVIDER_PREFIX)) {
        throw new Error('Host-managed providers cannot be deleted via user settings');
      }
      return manager.deleteProvider(id);
    }),
    magpieTestProvider: gated((_event, input) => manager.testProvider(input)),
    magpieDiagnostics: gated(() => manager.diagnostics()),
    magpiePreferences: gated(() => manager.preferences()),
    magpieUpdatePreferences: gated((_event, patch) => manager.updatePreferences(patch)),
    magpieRoutingGroups: gated(() => usage.routingGroups()),
    magpieSaveRoutingGroup: gated((_event, input) => usage.saveRoutingGroup(input)),
    magpieDeleteRoutingGroup: gated((_event, id) => usage.deleteRoutingGroup(id)),
    magpieArrangeRoutingGroups: gated((_event, order) => usage.arrangeRoutingGroups(order)),
    magpieUsageSummary: gated((_event, period) => usage.usageSummary(period)),
    magpieUsageRequests: gated((_event, period, offset, limit) =>
      usage.usageRequests(period, offset, limit),
    ),
    magpieUsageQuotas: gated((_event, asked) => usage.usageQuotas(asked)),
    magpieUsageBudget: gated(() => usage.usageBudget()),
  });
  return async () => {
    for (const channel of Object.values(MagpieIpc)) ipcMain.removeHandler(channel);
    await manager.shutdown();
  };
}
