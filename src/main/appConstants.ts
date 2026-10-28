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
// Development builds get their own data root so they never share the installed
// build's single-instance lock (Electron keys that lock by userData path).
export const DEV_APP_DATA_DIR_SUFFIX = 'Dev';
// Opt-in escape hatch for developers who intentionally want the installed profile.
export const SHARED_DEV_USER_DATA_ENV = 'ZHIYUAN_DEV_SHARED_USER_DATA';

export function resolveAppDataDirName(isEnterprise: boolean): string {
  return isEnterprise ? ENTERPRISE_APP_DATA_DIR_NAME : APP_DATA_DIR_NAME;
}

export function resolveUserDataDirName(options: {
  isEnterprise: boolean;
  isPackaged: boolean;
  sharedDevData: boolean;
}): string {
  const baseDirName = resolveAppDataDirName(options.isEnterprise);
  return options.isPackaged || options.sharedDevData
    ? baseDirName
    : `${baseDirName}${DEV_APP_DATA_DIR_SUFFIX}`;
}
