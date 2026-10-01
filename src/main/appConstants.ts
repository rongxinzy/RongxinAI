export const APP_NAME = '知远';
export const ENTERPRISE_APP_NAME = '知远企业版';
// Fresh storage directory for the ZhiYuan Agent brand; no migration from older directories.
export const APP_DATA_DIR_NAME = 'ZhiYuanAgent';
// Enterprise builds use a separate application data root so the two editions
// never read each other's configuration, sessions, or state. No migration:
// enterprise installs start with a fresh directory.
export const ENTERPRISE_APP_DATA_DIR_NAME = 'ZhiYuanAgentEnterprise';
export const APP_ID = 'zhiyuan';
export const APP_USER_MODEL_ID = 'com.zhiyuanagent.app';
export const DB_FILENAME = 'zhiyuan.sqlite';

export function resolveAppDataDirName(isEnterprise: boolean): string {
  return isEnterprise ? ENTERPRISE_APP_DATA_DIR_NAME : APP_DATA_DIR_NAME;
}
