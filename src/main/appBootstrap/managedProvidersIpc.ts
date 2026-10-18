/** AISphere / enterprise managed model provider IPC handlers. */
import { BrowserWindow } from 'electron';

import { rt } from './runtimeState';
import { aisphereService } from '../extensions/aisphere';
import { zhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { AISphere } from '../../shared/aisphere';
import { ManagedProviderIpc } from '../../shared/ipc/channels';
import { providersContract } from '../../shared/ipc/providersContract';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import { getBranding } from '../../shared/branding';

export const registerManagedProvidersIpc = (): void => {
  if (getBranding().features.enableAISphere) {
    handleIpcContractSubset(providersContract, {
      aisphereSnapshot: async () => aisphereService.snapshot(),
      aisphereConnect: async (_event, address) => aisphereService.connect(address),
      aisphereRefresh: async () => {
        await aisphereService.refresh();
        return aisphereService.snapshot();
      },
      managedProviderPolicy: async () => aisphereService.policy(),
      managedProviderCatalog: async () =>
        aisphereService.snapshot().models.map((model, index) => ({
          ...model,
          displayName: model.name,
          providerKey: AISphere.Provider,
          providerDisplayName: 'AISphere',
          isDefault: index === 0,
        })),
    });
    aisphereService.onChanged(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(ManagedProviderIpc.Changed);
      }
    });
  } else {
    handleIpcContractSubset(providersContract, {
      managedProviderPolicy: async () => zhiyuanManagedProviderBridge.accessPolicy(),
      managedProviderCatalog: async () => zhiyuanManagedProviderBridge.catalog(),
    });
    zhiyuanManagedProviderBridge.onDidChange(() => {
      if (rt.magpieManager?.status().state === 'running')
        void rt.managedMagpieBindings
          ?.synchronize()
          .catch(error => console.error('[Magpie] Managed catalog sync failed', error));
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(ManagedProviderIpc.Changed);
      }
    });
  }
};
