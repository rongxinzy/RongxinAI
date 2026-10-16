import { getBranding } from '../shared/branding';

const branding = getBranding();

export const APP_NAME = branding.shortName;
export const ENTERPRISE_APP_NAME = `${branding.shortName}企业版`;
// Storage directory for the active brand; no migration from older directories.
export const APP_DATA_DIR_NAME = branding.dataDirName;
// Enterprise builds use a separate application data root so the two editions
// never read each other's configuration, sessions, or state. No migration:
// enterprise installs start with a fresh directory.
export const ENTERPRISE_APP_DATA_DIR_NAME = `${branding.dataDirName}Enterprise`;
export const APP_USER_MODEL_ID = branding.appUserModelId;
export const DB_FILENAME = branding.dbFileName;

export function resolveAppDataDirName(isEnterprise: boolean): string {
  return isEnterprise ? ENTERPRISE_APP_DATA_DIR_NAME : APP_DATA_DIR_NAME;
}
