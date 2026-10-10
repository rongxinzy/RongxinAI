export const LicenseFormat = {
  V1: 'zhiyuan-license-v1',
} as const;

export type LicenseFormat = (typeof LicenseFormat)[keyof typeof LicenseFormat];

export const LicenseEdition = {
  Enterprise: 'enterprise',
} as const;

export type LicenseEdition = (typeof LicenseEdition)[keyof typeof LicenseEdition];

export const LicenseStatus = {
  Active: 'enterprise-active',
  Grace: 'enterprise-grace',
  Expired: 'enterprise-expired',
  Invalid: 'enterprise-invalid',
} as const;

export type LicenseStatus = (typeof LicenseStatus)[keyof typeof LicenseStatus];

export interface LicenseLimits {
  readonly users: number;
  readonly agents: number;
  readonly organizations?: number;
}

export interface LicenseClaims {
  readonly licenseId: string;
  readonly customerId: string;
  readonly deploymentId: string;
  readonly edition: LicenseEdition;
  readonly issuedAt: string;
  readonly notBefore?: string;
  readonly expiresAt: string;
  readonly maintenanceUntil?: string;
  readonly graceDays: number;
  readonly limits: LicenseLimits;
  readonly features: readonly string[];
}

export interface LicenseEnvelope {
  readonly format: LicenseFormat;
  readonly keyId: string;
  readonly payload: LicenseClaims;
  readonly signature: string;
}

export interface LicenseVerificationOptions {
  readonly trustedKeys: Readonly<Record<string, string>>;
  readonly expectedDeploymentId?: string;
  readonly now?: Date;
}

export const LicenseInvalidReason = {
  Malformed: 'malformed-license',
  UnsupportedFormat: 'unsupported-format',
  UnknownKey: 'unknown-signing-key',
  InvalidSignature: 'invalid-signature',
  DeploymentMismatch: 'deployment-mismatch',
  NotYetValid: 'not-yet-valid',
} as const;

export type LicenseInvalidReason = (typeof LicenseInvalidReason)[keyof typeof LicenseInvalidReason];

export type LicenseVerificationResult =
  | {
      readonly status:
        | typeof LicenseStatus.Active
        | typeof LicenseStatus.Grace
        | typeof LicenseStatus.Expired;
      readonly envelope: LicenseEnvelope;
      readonly digest: string;
      readonly graceEndsAt: string;
    }
  | {
      readonly status: typeof LicenseStatus.Invalid;
      readonly reason: LicenseInvalidReason;
    };

export interface LicenseSnapshot {
  readonly status: LicenseStatus | null;
  readonly licenseId: string | null;
  readonly customerId: string | null;
  readonly deploymentId: string | null;
  readonly expiresAt: string | null;
  readonly graceEndsAt: string | null;
  readonly features: readonly string[];
  readonly digest: string | null;
  readonly reason?: LicenseInvalidReason;
}
