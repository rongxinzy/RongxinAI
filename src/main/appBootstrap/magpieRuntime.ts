/** Magpie manager bootstrap: manager construction, managed-provider bindings and model service. */
import path from 'path';

import { app } from 'electron';

import { rt } from './runtimeState';
import { getOllamaManager, getStore } from './runtimeServices';
import { MagpieManager } from '../magpie/manager';
import { MagpieModelService, installMagpieModelService } from '../magpie/modelService';
import { ManagedMagpieProviderBindings } from '../magpie/managedProviderBindings';
import { readOllamaProviderSnapshot } from '../magpie/ollamaProviderBinding';
import { buildLlamaCppRunningModelBinding } from '../libs/llamacppAgentBinding';
import { registerMagpieIpc } from '../magpie/registerIpc';
import { registerAcpMagpieModelApply } from '../codingAgent/acpMagpieModel';
import { zhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';

let magpieModelService: MagpieModelService | undefined;

/** The Magpie model service installed by {@link setupMagpieRuntime}. */
export const getMagpieModelService = (): MagpieModelService | undefined => magpieModelService;

export const setupMagpieRuntime = (): void => {
  rt.magpieManager = new MagpieManager({
    resourcesRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'magpie')
      : path.join(app.getAppPath(), 'resources/magpie'),
    privateHome: path.join(app.getPath('userData'), 'magpie'),
    serviceEnabled: {
      read: () => getStore().get<boolean>('magpie_service_enabled') === true,
      write: enabled => getStore().set('magpie_service_enabled', enabled),
    },
    subscriptionAccounts: {
      read: () => getStore().get<boolean>('magpie_subscription_accounts_enabled') === true,
      write: enabled => getStore().set('magpie_subscription_accounts_enabled', enabled),
    },
  });
  rt.managedMagpieBindings = new ManagedMagpieProviderBindings(
    zhiyuanManagedProviderBridge,
    rt.magpieManager,
  );
  rt.managedMagpieBindings.setOllamaReader(() => readOllamaProviderSnapshot(getOllamaManager()));
  rt.managedMagpieBindings.setGpuReader(async () => {
    const daemon = rt.llamaCppModelDaemonController;
    if (!daemon) return { baseUrl: null, models: [] };
    const models = await daemon.listRunningModels();
    return {
      baseUrl: daemon.gatewayBaseUrl(),
      models: models
        .map(buildLlamaCppRunningModelBinding)
        .filter((model): model is NonNullable<typeof model> => Boolean(model)),
    };
  });
  const modelService = new MagpieModelService(rt.magpieManager, {
    readDefaultModelId: () => getStore().get<string>('magpie_default_model_id'),
    writeDefaultModelId: id => getStore().set('magpie_default_model_id', id),
    beforeCatalog: () => rt.managedMagpieBindings!.beforeCatalog(),
    allowedModel: model => rt.managedMagpieBindings!.allowedModel(model.id),
  });
  rt.disposeMagpieModels = installMagpieModelService(modelService);
  magpieModelService = modelService;
  registerAcpMagpieModelApply(async modelId => {
    const snapshot = await rt.magpieManager?.agents();
    for (const agent of snapshot?.agents ?? []) {
      if (agent.cliMissing) continue;
      for (const field of agent.models) {
        if (field.value === modelId) continue;
        if (!field.options.some(option => option.value === modelId)) continue;
        try {
          await rt.magpieManager?.setModel({ agentId: agent.id, field: field.key, value: modelId });
        } catch (error) {
          console.warn(`[CodingAgent] could not apply gateway model to ${agent.id}:`, error);
        }
      }
    }
  });
  rt.disposeMagpie = registerMagpieIpc(
    rt.magpieManager,
    event =>
      Boolean(
        rt.mainWindow &&
        !rt.mainWindow.isDestroyed() &&
        event.sender === rt.mainWindow.webContents &&
        event.senderFrame === rt.mainWindow.webContents.mainFrame,
      ),
    modelService,
  );
};
