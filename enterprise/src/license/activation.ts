import type { AepClient, EntitlementTokenResponse } from '@aep/sdk-node';

import type { ZhiyuanPasswordSession } from '../session/password-session.js';
import { type LicenseSnapshot, LicenseStatus } from './types.js';

export const ZHIYUAN_ENTITLEMENT_REFRESH_WINDOW_MS = 60_000;

export interface ZhiyuanLicenseActivationOptions {
  readonly session: ZhiyuanPasswordSession;
  readonly client: Pick<AepClient, 'activateEnterpriseLicense'>;
  readonly onError?: (error: unknown) => void;
}

/** Exchanges an authenticated session for the server's short-lived entitlement. */
export class ZhiyuanLicenseActivation {
  readonly #session: ZhiyuanPasswordSession;
  readonly #client: Pick<AepClient, 'activateEnterpriseLicense'>;
  readonly #onError: (error: unknown) => void;
  #unsubscribe: (() => void) | null = null;
  #activationPromise: Promise<EntitlementTokenResponse | null> | null = null;
  #entitlement: EntitlementTokenResponse | null = null;
  #snapshot: LicenseSnapshot = emptySnapshot();
  readonly #listeners = new Set<() => void>();

  static create(options: ZhiyuanLicenseActivationOptions): ZhiyuanLicenseActivation {
    return new ZhiyuanLicenseActivation(options);
  }

  private constructor(options: ZhiyuanLicenseActivationOptions) {
    this.#session = options.session;
    this.#client = options.client;
    this.#onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#session.onDidChange(() => {
      if (this.#session.snapshot().status === 'authenticated') void this.activate();
      else this.#clearEntitlement();
    });
    if (this.#session.snapshot().status === 'authenticated') void this.activate();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#clearEntitlement();
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshot(): LicenseSnapshot {
    return Object.freeze({
      ...this.#snapshot,
      features: Object.freeze([...this.#snapshot.features]),
    });
  }

  entitlement(): EntitlementTokenResponse | null {
    return this.#entitlement
      ? { ...this.#entitlement, features: [...this.#entitlement.features] }
      : null;
  }

  refreshIfNeeded(now = Date.now()): Promise<EntitlementTokenResponse | null> {
    const expiresAt = Date.parse(this.#entitlement?.expiresAt ?? '');
    if (Number.isFinite(expiresAt) && expiresAt > now + ZHIYUAN_ENTITLEMENT_REFRESH_WINDOW_MS) {
      return Promise.resolve(this.entitlement());
    }
    return this.activate();
  }

  async activate(): Promise<EntitlementTokenResponse | null> {
    if (this.#session.snapshot().status !== 'authenticated') return null;
    if (this.#activationPromise) return this.#activationPromise;
    this.#activationPromise = (async () => {
      try {
        const entitlement = await this.#client.activateEnterpriseLicense({});
        this.#entitlement = entitlement;
        this.#snapshot = Object.freeze({
          status: LicenseStatus.Active,
          licenseId: entitlement.licenseId,
          customerId: null,
          deploymentId: entitlement.deploymentId,
          expiresAt: entitlement.expiresAt,
          graceEndsAt: null,
          features: Object.freeze([...entitlement.features]),
          digest: entitlement.licenseDigest,
        });
        this.#emitChanged();
        return entitlement;
      } catch (error) {
        this.#clearEntitlement();
        this.#onError(error);
        return null;
      } finally {
        this.#activationPromise = null;
      }
    })();
    return this.#activationPromise;
  }

  #clearEntitlement(): void {
    this.#entitlement = null;
    this.#snapshot = emptySnapshot();
    this.#emitChanged();
  }

  #emitChanged(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // Projection listeners must not interrupt session lifecycle.
      }
    }
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
