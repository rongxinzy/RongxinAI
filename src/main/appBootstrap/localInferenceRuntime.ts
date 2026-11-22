import path from 'node:path';
import { app } from 'electron';

import { getLlamaCppServiceConfig, registerLlamaCppIpcHandlers } from '../ipcHandlers/llamacpp';
import { registerMarketplaceIpcHandlers } from '../ipcHandlers/marketplace';
import type { LocalGpuSnapshot } from '../libs/llamacppAgentBinding';
import { LlamaCppManager } from '../libs/llamacppManager';
import { resolveLlamaCppModelsDir } from '../libs/llamacppModelLibraryPath';
import { LOCAL_MODEL_CATALOG_FILE, LocalModelCatalog } from '../libs/localModelCatalog';
import { MarketplaceService } from '../libs/marketplaceService';
import type { SqliteStore } from '../sqliteStore';
import type { MagpieRuntime } from './magpieRuntime';

export function createLocalInferenceRuntime(getStore: () => SqliteStore) {
  let runtime: ReturnType<typeof registerLlamaCppIpcHandlers> | undefined;

  return {
    start(
      magpie: Pick<
        MagpieRuntime,
        'onLocalModelBindingsChanged' | 'onLanAccessChanged' | 'onLanAccessTokenRegenerated'
      >,
    ): void {
      if (runtime) return;
      const resources = app.isPackaged
        ? process.resourcesPath
        : path.join(app.getAppPath(), 'resources');
      const catalog = new LocalModelCatalog(
        path.join(resources, LOCAL_MODEL_CATALOG_FILE),
        app.getPath('userData'),
      );
      const readConfig = () => getLlamaCppServiceConfig(getStore());
      const marketplace = new MarketplaceService(
        () => resolveLlamaCppModelsDir(readConfig()),
        catalog,
      );
      const manager = new LlamaCppManager(readConfig, marketplace);
      manager.initializeModelsDir();
      runtime = registerLlamaCppIpcHandlers(manager, {
        getStore,
        onModelBindingsChanged: magpie.onLocalModelBindingsChanged,
        onLanAccessChanged: magpie.onLanAccessChanged,
        onLanAccessTokenRegenerated: magpie.onLanAccessTokenRegenerated,
      });
      registerMarketplaceIpcHandlers(marketplace, catalog);
      // Warm the short-lived backend cache.
      void manager.listBackends();
    },
    async readModelBindings(): Promise<LocalGpuSnapshot> {
      return runtime?.readModelBindings() ?? { baseUrl: null, models: [] };
    },
    stop(readyToStop: Promise<void>) {
      return runtime?.shutdownForQuit(readyToStop);
    },
  };
}

export type LocalInferenceRuntime = ReturnType<typeof createLocalInferenceRuntime>;
