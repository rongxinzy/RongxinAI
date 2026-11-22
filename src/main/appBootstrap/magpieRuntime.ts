/** Magpie manager bootstrap: manager construction, managed-provider bindings and model service. */
import path from 'path';

import { app } from 'electron';
import { getBranding } from '../../shared/branding';

import { lifecycleRuntime } from './lifecycleRuntimeState';
import { getStore, getStoreIfOpen } from './runtimeServices';
import { resolveDefaultAgentModelRef } from './defaultAgentModel';
import { MagpieManager } from '../magpie/manager';
import { MAGPIE_DEFAULT_MODEL_ID_KEY, MagpieModelService } from '../magpie/modelService';
import { isLlamaCppLanAccessEnabled } from '../magpie/lanAccess';
import { ManagedMagpieProviderBindings } from '../magpie/managedProviderBindings';
import { LlamaCppGatewayCredentialVault } from '../libs/llamacppGatewayCredentialVault';
import type { LlamaCppRunningModelBinding, LocalGpuSnapshot } from '../libs/llamacppAgentBinding';
import { getLlamaCppServiceConfig } from '../ipcHandlers/llamacpp';
import { registerMagpieIpc } from '../magpie/registerIpc';
import { zhiyuanManagedProviderBridge } from '../enterpriseExtension/managedProviderBridge';
import { startEnterpriseModelGateway } from '../enterpriseExtension/modelGateway';
import { aisphereService, startAISphereGateway } from '../extensions/aisphere';
import type { SqliteStore } from '../sqliteStore';

/** LAN gateway credential store; created lazily because the SQLite store starts later. */
let lanCredentialVault: LlamaCppGatewayCredentialVault | undefined;
const getLanCredentialVault = (): LlamaCppGatewayCredentialVault => {
  if (!lanCredentialVault) lanCredentialVault = new LlamaCppGatewayCredentialVault(getStore());
  return lanCredentialVault;
};

export const setupMagpieRuntime = (readLocalModels: () => Promise<LocalGpuSnapshot>) => {
  let enterpriseGateway: Awaited<ReturnType<typeof startEnterpriseModelGateway>> | undefined;
  const manager = new MagpieManager({
    enterpriseForward: () => enterpriseGateway,
    resourcesRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'magpie')
      : path.join(app.getAppPath(), 'resources/magpie'),
    privateHome: path.join(app.getPath('userData'), 'magpie'),
    gatewayPort: {
      read: () => {
        const value = getStore().get<number>('magpie_gateway_port');
        return typeof value === 'number' ? value : undefined;
      },
      write: port => getStore().set('magpie_gateway_port', port),
    },
    serviceEnabled: {
      read: () => getStoreIfOpen()?.get<boolean>('magpie_service_enabled') === true,
      write: enabled => getStore().set('magpie_service_enabled', enabled),
    },
    subscriptionAccounts: {
      read: () => getStoreIfOpen()?.get<boolean>('magpie_subscription_accounts_enabled') === true,
      write: enabled => getStore().set('magpie_subscription_accounts_enabled', enabled),
    },
    lanAccess: {
      read: () => {
        const enabled = isLlamaCppLanAccessEnabled(getLlamaCppServiceConfig(getStore()));
        return {
          enabled,
          // Mint on read when LAN is on: a user who enables LAN before ever
          // opening the token dialog still gets a key imported, and the same
          // token is what the dialog later shows.
          lanToken: enabled ? getLanCredentialVault().ensureLanToken() : null,
        };
      },
    },
  });
  const organization = getBranding().features.enableAISphere ? aisphereService : undefined;
  const bindings = new ManagedMagpieProviderBindings(zhiyuanManagedProviderBridge, manager, {
    organization,
    enterpriseOrigin: () => enterpriseGateway?.origin,
    readLocalModels,
  });
  const modelService = new MagpieModelService(
    manager,
    {
      readDefaultModelId: resolveDefaultAgentModelRef,
      writeDefaultModelId: id => getStore().set(MAGPIE_DEFAULT_MODEL_ID_KEY, id),
      beforeCatalog: owner => bindings.beforeCatalog(owner),
      allowedModel: model => bindings.allowedModel(model.id, model.owned_by),
      allowProviderFallback: !organization,
      readLocalGpuEligibility: id => bindings.localGpuEligibility(id),
    },
    manager.routingUsage,
  );
  const closeIpc = registerMagpieIpc(
    manager,
    event =>
      Boolean(
        lifecycleRuntime.mainWindow &&
        !lifecycleRuntime.mainWindow.isDestroyed() &&
        event.sender === lifecycleRuntime.mainWindow.webContents &&
        event.senderFrame === lifecycleRuntime.mainWindow.webContents.mainFrame,
      ),
    modelService,
  );
  const stopManagedGateway = async (): Promise<void> => {
    const gateway = enterpriseGateway;
    enterpriseGateway = undefined;
    if (organization) await organization.shutdown();
    else await gateway?.close();
  };

  return {
    modelService,
    isRunning: () => manager.status().state === 'running',
    synchronizeCatalog: () => bindings.synchronize(),
    onLocalModelBindingsChanged: async (
      url: string | null,
      models: readonly LlamaCppRunningModelBinding[],
    ) => {
      bindings.setGpuSnapshot(url, models);
      if (manager.status().state === 'running') await bindings.synchronize();
    },
    onLanAccessChanged: async () => {
      await manager.onLanAccessChanged();
    },
    onLanAccessTokenRegenerated: async () => {
      await manager.onLanAccessTokenRegenerated();
    },
    start: async () => {
      try {
        if (getStore().get<boolean>('magpie_service_enabled') === true) {
          await manager.ensureRunning();
        } else {
          // LAN access can start the bundled gateway independently.
          await manager.onLanAccessChanged();
        }
      } catch (error) {
        console.warn('[Magpie] Model gateway startup failed:', error);
      }
    },
    startManagedGateway: async (store: SqliteStore, busy: () => boolean, enterprise: boolean) => {
      try {
        if (organization) {
          organization.busy = busy;
          await organization.initialize(store, startAISphereGateway);
        } else if (enterprise) {
          const gateway = await startEnterpriseModelGateway(zhiyuanManagedProviderBridge);
          if (lifecycleRuntime.isQuitting) {
            await gateway.close();
            return;
          }
          enterpriseGateway = gateway;
        }
      } catch (error) {
        console.error('[Magpie] Failed to initialize the managed model transport:', error);
        await stopManagedGateway().catch(closeError => {
          console.warn('[Magpie] Failed to close the managed model transport:', closeError);
        });
      }
    },
    stopManagedGateway,
    onSuspend: () => manager.onSuspend(),
    recoverIfNeeded: () => manager.recoverIfNeeded(),
    closeAdmission: closeIpc,
    disconnectExternalAgents: async (signal: AbortSignal) => {
      await manager.disconnectAllAgents(signal);
    },
    shutdown: async () => {
      await manager.shutdown();
    },
  };
};

export type MagpieRuntime = ReturnType<typeof setupMagpieRuntime>;
