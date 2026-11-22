import type {
  AppSystemInvokers,
  dialogChannels,
  projectChannels,
  shellChannels,
  appInfoChannels,
  appUpdateChannels,
  logChannels,
} from '../../../shared/ipc/appSystemContract.channels';

export type DialogApi = AppSystemInvokers<typeof dialogChannels>;
export type ProjectApi = AppSystemInvokers<typeof projectChannels>;
export type ShellApi = AppSystemInvokers<typeof shellChannels>;
export type AppInfoApi = AppSystemInvokers<typeof appInfoChannels>;
export interface AppUpdateApi extends AppSystemInvokers<typeof appUpdateChannels> {
  onStateChanged: (
    callback: (data: import('../../../shared/appUpdate/constants').AppUpdateRuntimeState) => void,
  ) => () => void;
}

export interface LogApi extends AppSystemInvokers<typeof logChannels> {
  fromRenderer: (level: string, tag: string, message: string) => void;
}
