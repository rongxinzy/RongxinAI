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
});
