import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import type {
  StrataServiceConfig,
  StrataStartInput,
  StrataStatusSnapshot,
  StrataMarketplaceVariant,
  StrataInstallState,
} from '../../shared/strata/types';
import { StrataServiceStatus } from '../../shared/strata/types';
import { StrataIpcChannel } from '../../shared/strata/constants';
import { strataContract } from '../../shared/ipc/strataContract';
import { handleIpcContract } from '../ipc/handleIpcContract';
import type { StrataManager } from '../libs/strata/strataManager';
import { STRATA_MODEL_CATALOG, getStrataCatalogEntry } from '../libs/strata/strataModelCatalog';
import { StrataModelInstallation } from '../libs/strata/strataModelInstallation';
import { getAppLocalModelCatalog } from '../libs/appLocalModelCatalog';
import {
  readStrataProviderSnapshot,
  type StrataProviderSnapshot,
} from '../magpie/strataProviderBinding';
import type { SqliteStore } from '../sqliteStore';

const STRATA_SERVICE_CONFIG_KEY = 'strata_service_config';

export function getStrataServiceConfig(store: SqliteStore): StrataServiceConfig {
  const value = store.get<StrataServiceConfig>(STRATA_SERVICE_CONFIG_KEY);
  return value && typeof value === 'object' ? value : {};
}

export function registerStrataIpcHandlers(
  manager: StrataManager,
  options: {
    getStore: () => SqliteStore;
    onModelBindingsChanged?: (snapshot: StrataProviderSnapshot) => void | Promise<void>;
  },
): void {
  const userData = app.getPath('userData');
  let variants: Map<string, StrataMarketplaceVariant[]> | undefined;
  const readVariants = () =>
    (variants ??= getAppLocalModelCatalog(userData).readBundledStrataVariants());
  const installation = new StrataModelInstallation(path.join(userData, 'strata'), readVariants);
  const requireBundled = () => {
    if (!manager.isBundled()) throw new Error('Strata requires the Windows CUDA edition.');
  };
  const broadcast = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };

  const publishBindings = async (snapshot: StrataProviderSnapshot): Promise<void> => {
    try {
      await options.onModelBindingsChanged?.(snapshot);
    } catch {
      console.warn('[Strata] unified model catalog synchronization failed');
    }
  };

  let bindingRevision = 0;
  const clearBindings = async (): Promise<void> => {
    bindingRevision++;
    await publishBindings({ baseUrl: null, models: [] });
  };

  const refreshBindings = async (): Promise<void> => {
    const revision = ++bindingRevision;
    let snapshot: StrataProviderSnapshot;
    try {
      snapshot = await readStrataProviderSnapshot(manager);
    } catch {
      snapshot = { baseUrl: null, models: [] };
    }
    // A stop, exit or newer refresh supersedes any older model-list response.
    if (revision === bindingRevision) await publishBindings(snapshot);
  };

  const sendStatus = (status: StrataStatusSnapshot) => {
    broadcast(StrataIpcChannel.StatusChanged, status);
    // refreshBindings reads the snapshot the manager just published; it must
    // not probe the service again or the status event would re-trigger itself.
    if (status.status === StrataServiceStatus.Running) void refreshBindings();
    else void clearBindings();
  };

  manager.on('status', sendStatus);

  handleIpcContract(strataContract, {
    isBundled: async () => manager.isBundled(),
    catalog: async () => {
      const variants = readVariants();
      return STRATA_MODEL_CATALOG.map(entry => ({
        ...entry,
        marketplaceVariants: variants.get(entry.id),
      }));
    },
    status: async () => manager.detect(),
    install: async (_event, ref) => {
      requireBundled();
      installation.start(ref);
    },
    installState: async (): Promise<StrataInstallState> =>
      manager.isBundled() ? installation.state() : { installed: [] },
    cancelInstall: async (_event, ref) => installation.cancel(ref),
    start: async (_event, input: StrataStartInput) => {
      requireBundled();
      const launchId = input.launchId ?? getStrataCatalogEntry(input.catalogId)?.modelLaunchId;
      if (
        !launchId ||
        !(await installation.isInstalled({ catalogId: input.catalogId, launchId }))
      ) {
        throw new Error('Install this Strata model in the model marketplace before starting it.');
      }
      const status = await manager.start({ ...input, launchId }, installation.dataDir);
      await refreshBindings();
      return status;
    },
    stop: async () => {
      const status = await manager.stop();
      await clearBindings();
      return status;
    },
    getServiceConfig: async () => getStrataServiceConfig(options.getStore()),
    setServiceConfig: async (_event, config: StrataServiceConfig) => {
      const sanitized: StrataServiceConfig = {};
      if (config.port?.trim()) sanitized.port = config.port.trim();
      options.getStore().set(STRATA_SERVICE_CONFIG_KEY, sanitized);
      return sanitized;
    },
  });
}
