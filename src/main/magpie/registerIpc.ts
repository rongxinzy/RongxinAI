import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import { MagpieIpc } from '../../shared/ipc/providersContract.channels';
import { magpieContract } from '../../shared/ipc/providersContract';
import { handleIpcContract } from '../ipc/handleIpcContract';
import type { MagpieManager } from './manager';
import type { MagpieModelService } from './modelService';
import { HOST_PROVIDER_PREFIX } from './hostProviders';

/** The app supplies its existing trusted-main-frame predicate. No arbitrary URL/HTTP IPC. */
export function registerMagpieIpc(
  manager: MagpieManager,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  models: MagpieModelService,
): () => Promise<void> {
  const usage = manager.routingUsage;
  const pending = new Set<Promise<unknown>>();
  let closing = false;
  const assertAdmitted = (event: IpcMainInvokeEvent): void => {
    if (!trusted(event)) throw new Error('Untrusted model management request');
    if (closing) throw new Error('The model service is shutting down.');
  };
  const routeMutation = <T>(task: Promise<T>): Promise<T> =>
    task.finally(() => models.invalidateCatalog());
  // All magpie channels share one trust gate (main-frame sender only); apply
  // it around each impl so the contract layer keeps its arg validation.
  const gated =
    <A extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    async (event: IpcMainInvokeEvent, ...args: A): Promise<Awaited<R>> => {
      assertAdmitted(event);
      const task = Promise.resolve(handler(event, ...args));
      pending.add(task);
      try {
        return await task;
      } finally {
        pending.delete(task);
      }
    };

  handleIpcContract(magpieContract, {
    catalog: gated(() => models.catalog()),
    selectDefault: gated((_event, id) => models.selectDefault(id)),
    setSubscriptionAccounts: gated((_event, enabled) =>
      routeMutation(manager.setSubscriptionAccounts(enabled)),
    ),
    status: gated(() => manager.status()),
    start: gated(() => manager.start()),
    stop: gated(() => manager.stop()),
    agents: gated(() => manager.agents()),
    setModel: gated((_event, selection) => manager.setModel(selection)),
    previewAgent: gated((_event, agentId) => manager.previewAgent(agentId)),
    connectAgent: gated((_event, agentId) => manager.connectAgent(agentId)),
    disconnectAgent: gated((_event, agentId) => manager.disconnectAgent(agentId)),
    disconnectAllAgents: gated(() => manager.disconnectAllAgents()),
    providers: gated(() => manager.providers()),
    saveProvider: gated((_event, input) => {
      if (input?.id?.startsWith(HOST_PROVIDER_PREFIX)) {
        throw new Error('Host-managed providers cannot be modified via user settings');
      }
      return routeMutation(manager.saveProvider(input));
    }),
    setProviderEnabled: gated((_event, id, enabled) => {
      if (id.startsWith(HOST_PROVIDER_PREFIX)) {
        throw new Error('Host-managed providers cannot be toggled via user settings');
      }
      return routeMutation(manager.setProviderEnabled(id, enabled));
    }),
    deleteProvider: gated((_event, id) => {
      if (id.startsWith(HOST_PROVIDER_PREFIX)) {
        throw new Error('Host-managed providers cannot be deleted via user settings');
      }
      return routeMutation(manager.deleteProvider(id));
    }),
    testProvider: (event, input) => {
      assertAdmitted(event);
      return manager.testProvider(input);
    },
    diagnostics: gated(() => manager.diagnostics()),
    clearDiagnostics: gated(() => manager.clearDiagnostics()),
    preferences: gated(() => manager.preferences()),
    updatePreferences: gated((_event, patch) => manager.updatePreferences(patch)),
    routingGroups: gated(() => usage.routingGroups()),
    saveRoutingGroup: gated((_event, input) => routeMutation(usage.saveRoutingGroup(input))),
    deleteRoutingGroup: gated((_event, id) => routeMutation(usage.deleteRoutingGroup(id))),
    arrangeRoutingGroups: gated((_event, order) =>
      routeMutation(usage.arrangeRoutingGroups(order)),
    ),
    usageSummary: gated((_event, period) => usage.usageSummary(period)),
    usageRequests: gated((_event, period, offset, limit) =>
      usage.usageRequests(period, offset, limit),
    ),
    usageQuotas: gated((_event, asked) => usage.usageQuotas(asked)),
    usageBudget: gated(() => usage.usageBudget()),
  });
  return async () => {
    if (!closing) {
      closing = true;
      for (const channel of Object.values(MagpieIpc)) ipcMain.removeHandler(channel);
    }
    await Promise.allSettled(pending);
  };
}
