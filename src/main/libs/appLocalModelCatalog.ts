import { app } from 'electron';
import path from 'node:path';

import { LOCAL_MODEL_CATALOG_FILE, LocalModelCatalog } from './localModelCatalog';

const catalogs = new Map<string, LocalModelCatalog>();

export function getAppLocalModelCatalog(userDataPath: string): LocalModelCatalog {
  const existing = catalogs.get(userDataPath);
  if (existing) return existing;
  const resources = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');
  const catalog = new LocalModelCatalog(
    path.join(resources, LOCAL_MODEL_CATALOG_FILE),
    userDataPath,
  );
  catalogs.set(userDataPath, catalog);
  return catalog;
}
