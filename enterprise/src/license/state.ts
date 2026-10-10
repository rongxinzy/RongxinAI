import { type LicenseSnapshot, LicenseStatus, type LicenseVerificationOptions } from './types.js';
import { verifyLicense } from './verifier.js';

export class ZhiyuanLicenseStateMachine {
  readonly #options: LicenseVerificationOptions;
  #snapshot: LicenseSnapshot = Object.freeze(emptySnapshot());

  constructor(options: LicenseVerificationOptions) {
    this.#options = Object.freeze({ ...options });
  }

  snapshot(): LicenseSnapshot {
    return Object.freeze({
      ...this.#snapshot,
      features: Object.freeze([...this.#snapshot.features]),
    });
  }

  load(input: string | unknown, now = new Date()): LicenseSnapshot {
    const result = verifyLicense(input, { ...this.#options, now });
    if (result.status === LicenseStatus.Invalid) {
      this.#snapshot = Object.freeze({
        ...emptySnapshot(),
        status: LicenseStatus.Invalid,
        reason: result.reason,
      });
      return this.snapshot();
    }
    const claims = result.envelope.payload;
    this.#snapshot = Object.freeze({
      status: result.status,
      licenseId: claims.licenseId,
      customerId: claims.customerId,
      deploymentId: claims.deploymentId,
      expiresAt: claims.expiresAt,
      graceEndsAt: result.graceEndsAt,
      features: Object.freeze([...claims.features]),
      digest: result.digest,
    });
    return this.snapshot();
  }

  clear(): LicenseSnapshot {
    this.#snapshot = Object.freeze(emptySnapshot());
    return this.snapshot();
  }
}

function emptySnapshot(): LicenseSnapshot {
  return {
    status: null,
    licenseId: null,
    customerId: null,
    deploymentId: null,
    expiresAt: null,
    graceEndsAt: null,
    features: [],
    digest: null,
  };
}
