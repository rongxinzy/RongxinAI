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
  #generation = 0;
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
      this.#clearEntitlement();
      if (this.#session.snapshot().status === 'authenticated') void this.activate();
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
      ? {
          ...this.#entitlement,
          features: [...this.#entitlement.features],
          modelScopes: [...this.#entitlement.modelScopes],
        }
      : null;
  }

  async refreshIfNeeded(
    now = Date.now(),
    modelScopes: readonly string[] = [],
  ): Promise<EntitlementTokenResponse | null> {
    // A login-time exchange may still contain the previous catalog. Wait for
    // it, then check its scopes before deciding whether to reuse it.
    if (this.#activationPromise) await this.#activationPromise;
    const expiresAt = Date.parse(this.#entitlement?.expiresAt ?? '');
    const coversModels = modelScopes.every(scope => this.#entitlement?.modelScopes.includes(scope));
    if (
      Number.isFinite(expiresAt) &&
      expiresAt > now + ZHIYUAN_ENTITLEMENT_REFRESH_WINDOW_MS &&
      coversModels
    ) {
      return this.entitlement();
    }
    return this.activate();
  }

  async activate(): Promise<EntitlementTokenResponse | null> {
    if (this.#session.snapshot().status !== 'authenticated') return null;
    if (this.#activationPromise) return this.#activationPromise;
    const generation = this.#generation;
    this.#activationPromise = (async () => {
      try {
        const entitlement = await this.#client.activateEnterpriseLicense({});
        if (generation !== this.#generation || this.#session.snapshot().status !== 'authenticated')
          return null;
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
        if (generation === this.#generation) {
          this.#clearEntitlement();
          this.#onError(error);
        }
        return null;
      } finally {
        if (generation === this.#generation) this.#activationPromise = null;
      }
    })();
    return this.#activationPromise;
  }

  #clearEntitlement(): void {
    this.#generation++;
    this.#activationPromise = null;
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
