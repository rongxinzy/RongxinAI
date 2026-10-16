/** AISphere / enterprise managed model provider IPC handlers. */
import { BrowserWindow, ipcMain } from 'electron';

import { rt } from './runtimeState';
import { aisphereService } from '../extensions/aisphere';
import { zhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { AISphere, AISphereIpc } from '../../shared/aisphere';
import { ManagedProviderIpc } from '../../shared/ipc/channels';
import { getBranding } from '../../shared/branding';

export const registerManagedProvidersIpc = (): void => {
  if (getBranding().features.enableAISphere) {
    ipcMain.handle(AISphereIpc.Snapshot, () => aisphereService.snapshot());
    ipcMain.handle(AISphereIpc.Connect, (_event, address: unknown) =>
      aisphereService.connect(address),
    );
    ipcMain.handle(AISphereIpc.Refresh, async () => {
      await aisphereService.refresh();
      return aisphereService.snapshot();
    });
    ipcMain.handle(ManagedProviderIpc.Policy, () => aisphereService.policy());
    ipcMain.handle(ManagedProviderIpc.Catalog, () =>
      aisphereService.snapshot().models.map((model, index) => ({
        ...model,
        displayName: model.name,
        providerKey: AISphere.Provider,
        providerDisplayName: 'AISphere',
        isDefault: index === 0,
      })),
    );
    aisphereService.onChanged(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(ManagedProviderIpc.Changed);
      }
    });
  } else {
    ipcMain.handle(ManagedProviderIpc.Policy, () => zhiyuanManagedProviderBridge.accessPolicy());
    ipcMain.handle(ManagedProviderIpc.Catalog, () => zhiyuanManagedProviderBridge.catalog());
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
