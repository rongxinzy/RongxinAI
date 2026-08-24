export const ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION = 1 as const;

export const ZhiyuanEnterpriseExtensionStatus = {
  Idle: 'idle',
  Absent: 'absent',
  Active: 'active',
  Failed: 'failed',
  Disposed: 'disposed',
} as const;

export type ZhiyuanEnterpriseExtensionStatus =
  (typeof ZhiyuanEnterpriseExtensionStatus)[keyof typeof ZhiyuanEnterpriseExtensionStatus];

export interface ZhiyuanEnterpriseHostContext {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION;
  readonly appVersion: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly paths: {
    readonly resources: string;
    readonly userData: string;
  };
}

export interface ZhiyuanEnterpriseExtension {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION;
  readonly id: string;
  initialize(context: ZhiyuanEnterpriseHostContext): Promise<void>;
  dispose(): Promise<void>;
}

export interface ZhiyuanEnterpriseExtensionModule {
  createZhiyuanEnterpriseExtension():
    | ZhiyuanEnterpriseExtension
    | Promise<ZhiyuanEnterpriseExtension>;
}

export interface ZhiyuanEnterpriseExtensionSnapshot {
  readonly status: ZhiyuanEnterpriseExtensionStatus;
  readonly extensionId: string | null;
}
