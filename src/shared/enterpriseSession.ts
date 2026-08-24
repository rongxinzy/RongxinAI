export const EnterpriseSessionIpc = {
  Snapshot: 'enterprise:session:snapshot',
  Login: 'enterprise:session:login',
  ChangePassword: 'enterprise:session:change-password',
  Logout: 'enterprise:session:logout',
} as const;

export type EnterpriseSessionIdentity = {
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly email?: string | null;
  };
  readonly enterprise: {
    readonly id: string;
    readonly name: string;
  };
  readonly roles: readonly string[];
  readonly sessionExpiresAt: string;
  readonly passwordChangeRequired: boolean;
};

export type EnterpriseSessionSnapshot =
  | { readonly status: 'unavailable' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'recoverable' }
  | { readonly status: 'authenticated'; readonly identity: EnterpriseSessionIdentity };

export type EnterpriseSessionErrorCode = 'UNAVAILABLE' | 'INVALID_INPUT' | 'OPERATION_FAILED';

export type EnterpriseSessionResult =
  | { readonly ok: true; readonly snapshot: EnterpriseSessionSnapshot }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: EnterpriseSessionErrorCode;
        readonly message: string;
      };
    };

export interface EnterprisePasswordLoginInput {
  readonly enterpriseId: string;
  readonly username: string;
  readonly password: string;
}

export interface EnterprisePasswordChangeInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}
