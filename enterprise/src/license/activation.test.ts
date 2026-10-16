import { describe, expect, test, vi } from 'vitest';

import { ZhiyuanLicenseActivation } from './activation.js';
import { LicenseStatus } from './types.js';

describe('ZhiyuanLicenseActivation', () => {
  test('exchanges an authenticated session without receiving a License file', async () => {
    let authenticated = true;
    const session = {
      snapshot: () => ({
        status: authenticated ? ('authenticated' as const) : ('signed-out' as const),
      }),
      onDidChange: () => () => undefined,
    };
    const activateEnterpriseLicense = vi.fn(async () => ({
      entitlementToken: 'entitlement',
      tokenType: 'Bearer' as const,
      expiresAt: '2026-09-09T00:00:00.000Z',
      expiresIn: 3600,
      licenseId: 'lic-1',
      licenseDigest: 'sha256:digest',
      deploymentId: 'deployment-1',
      features: ['enterprise.models'],
      modelScopes: ['enterprise-chat'],
    }));

    const activation = ZhiyuanLicenseActivation.create({
      session: session as never,
      client: { activateEnterpriseLicense },
    });
    const result = await activation.activate();

    expect(activateEnterpriseLicense).toHaveBeenCalledWith({});
    expect(result?.licenseId).toBe('lic-1');
    expect(activation.snapshot()).toMatchObject({
      status: LicenseStatus.Active,
      licenseId: 'lic-1',
    });
    authenticated = false;
    activation.stop();
    expect(activation.entitlement()).toBeNull();
  });

  test('refreshes an entitlement only when it is close to expiry', async () => {
    const session = {
      snapshot: () => ({ status: 'authenticated' as const }),
      onDidChange: () => () => undefined,
    };
    const activateEnterpriseLicense = vi.fn(async () => ({
      entitlementToken: 'entitlement',
      tokenType: 'Bearer' as const,
      expiresAt: '2026-09-09T00:00:00.000Z',
      expiresIn: 3600,
      licenseId: 'lic-1',
      licenseDigest: 'sha256:digest',
      deploymentId: 'deployment-1',
      features: ['enterprise.models'],
      modelScopes: ['enterprise-chat'],
    }));
    const activation = ZhiyuanLicenseActivation.create({
      session: session as never,
      client: { activateEnterpriseLicense },
    });

    await activation.activate();
    await activation.refreshIfNeeded(Date.parse('2026-09-08T22:00:00.000Z'));
    expect(activateEnterpriseLicense).toHaveBeenCalledTimes(1);

    await activation.refreshIfNeeded(Date.parse('2026-09-08T23:59:30.000Z'));
    expect(activateEnterpriseLicense).toHaveBeenCalledTimes(2);
  });

  test('reissues an unexpired entitlement when a newly granted model is missing', async () => {
    let modelScopes = ['first'];
    const activateEnterpriseLicense = vi.fn(async () => ({
      entitlementToken: `entitlement-${modelScopes.join('-')}`,
      tokenType: 'Bearer' as const,
      expiresAt: '2099-01-01T00:00:00.000Z',
      expiresIn: 86400,
      licenseId: 'lic-1',
      licenseDigest: 'digest',
      deploymentId: 'deployment-1',
      features: ['enterprise.models'],
      modelScopes: [...modelScopes],
    }));
    const activation = ZhiyuanLicenseActivation.create({
      session: {
        snapshot: () => ({ status: 'authenticated' }),
        onDidChange: () => () => undefined,
      } as never,
      client: { activateEnterpriseLicense },
    });
    await activation.activate();
    modelScopes = ['first', 'new-grant'];
    await activation.refreshIfNeeded(Date.now(), modelScopes);
    expect(activateEnterpriseLicense).toHaveBeenCalledTimes(2);
    expect(activation.entitlement()?.modelScopes).toEqual(modelScopes);
    await activation.refreshIfNeeded(Date.now(), [...modelScopes].reverse());
    expect(activateEnterpriseLicense).toHaveBeenCalledTimes(2);
  });

  test('does not restore an entitlement when activation completes after sign-out', async () => {
    let status = 'authenticated';
    let listener = () => {};
    let finish!: (value: never) => void;
    const activation = ZhiyuanLicenseActivation.create({
      session: {
        snapshot: () => ({ status }),
        onDidChange: (callback: () => void) => {
          listener = callback;
          return () => {};
        },
      } as never,
      client: {
        activateEnterpriseLicense: () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      },
    });
    activation.start();
    const pending = activation.activate();
    status = 'signed-out';
    listener();
    finish({
      entitlementToken: 'stale',
      expiresAt: '2099-01-01T00:00:00Z',
      features: [],
      modelScopes: [],
    } as never);
    await expect(pending).resolves.toBeNull();
    expect(activation.entitlement()).toBeNull();
    expect(activation.snapshot().status).toBeNull();
  });

  test('checks model scopes again after a pending login-time activation', async () => {
    let finish!: (value: never) => void;
    const response = {
      entitlementToken: 'updated',
      tokenType: 'Bearer' as const,
      expiresAt: '2099-01-01T00:00:00Z',
      expiresIn: 86400,
      licenseId: 'lic-1',
      licenseDigest: 'digest',
      deploymentId: 'deployment-1',
      features: [],
      modelScopes: ['first', 'new-grant'],
    };
    const activateEnterpriseLicense = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(response);
    const activation = ZhiyuanLicenseActivation.create({
      session: { snapshot: () => ({ status: 'authenticated' }) } as never,
      client: { activateEnterpriseLicense },
    });
    const initial = activation.activate();
    const refreshed = activation.refreshIfNeeded(Date.now(), ['first', 'new-grant']);
    finish({ ...response, entitlementToken: 'old', modelScopes: ['first'] } as never);
    await initial;
    await expect(refreshed).resolves.toMatchObject({ entitlementToken: 'updated' });
    expect(activateEnterpriseLicense).toHaveBeenCalledTimes(2);
  });
});
