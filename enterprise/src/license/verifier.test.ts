import crypto from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { canonicalize } from './canonical.js';
import { ZhiyuanLicenseStateMachine } from './state.js';
import {
  type LicenseClaims,
  type LicenseEnvelope,
  LicenseInvalidReason,
  LicenseStatus,
} from './types.js';
import { verifyLicense } from './verifier.js';

const keyPair = crypto.generateKeyPairSync('ed25519');

describe('License v1 verifier', () => {
  const publicKey = keyPair.publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64url');
  const claims: LicenseClaims = {
    licenseId: 'lic-1',
    customerId: 'customer-1',
    deploymentId: 'deployment-1',
    edition: 'enterprise',
    issuedAt: '2026-08-31T00:00:00.000Z',
    expiresAt: '2026-09-10T00:00:00.000Z',
    graceDays: 2,
    limits: { users: 10, agents: 20 },
    features: ['enterprise.models', 'enterprise.skills'],
  };

  test('accepts a valid signature and exposes a stable digest', () => {
    const envelope = sign(claims);
    const result = verifyLicense(JSON.stringify(envelope), {
      trustedKeys: { 'license-prod-1': publicKey },
      expectedDeploymentId: 'deployment-1',
      now: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(result.status).toBe(LicenseStatus.Active);
    if (result.status === LicenseStatus.Invalid) return;
    expect(result.envelope.payload.licenseId).toBe('lic-1');
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('rejects payload tampering and unknown signing keys', () => {
    const envelope = sign(claims);
    const tampered = { ...envelope, payload: { ...claims, customerId: 'attacker' } };
    expect(verifyLicense(tampered, { trustedKeys: { 'license-prod-1': publicKey } })).toEqual({
      status: LicenseStatus.Invalid,
      reason: LicenseInvalidReason.InvalidSignature,
    });
    expect(verifyLicense(envelope, { trustedKeys: {} })).toEqual({
      status: LicenseStatus.Invalid,
      reason: LicenseInvalidReason.UnknownKey,
    });
  });

  test('rejects a license for another deployment and before its validity window', () => {
    const envelope = sign({ ...claims, notBefore: '2026-09-05T00:00:00.000Z' });
    expect(
      verifyLicense(envelope, {
        trustedKeys: { 'license-prod-1': publicKey },
        expectedDeploymentId: 'deployment-2',
      }),
    ).toEqual({ status: LicenseStatus.Invalid, reason: LicenseInvalidReason.DeploymentMismatch });
    expect(
      verifyLicense(envelope, {
        trustedKeys: { 'license-prod-1': publicKey },
        expectedDeploymentId: 'deployment-1',
        now: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).toEqual({ status: LicenseStatus.Invalid, reason: LicenseInvalidReason.NotYetValid });
  });

  test('moves from active to grace to expired without changing the signed claims', () => {
    const envelope = sign(claims);
    const machine = new ZhiyuanLicenseStateMachine({
      trustedKeys: { 'license-prod-1': publicKey },
      expectedDeploymentId: 'deployment-1',
    });
    expect(machine.load(envelope, new Date('2026-09-09T00:00:00.000Z')).status).toBe(
      LicenseStatus.Active,
    );
    expect(machine.load(envelope, new Date('2026-09-11T00:00:00.000Z')).status).toBe(
      LicenseStatus.Grace,
    );
    expect(machine.load(envelope, new Date('2026-09-13T00:00:00.000Z')).status).toBe(
      LicenseStatus.Expired,
    );
    expect(machine.clear().status).toBeNull();
  });
});

function sign(payload: LicenseClaims): LicenseEnvelope {
  const signature = crypto.sign(
    null,
    Buffer.from(canonicalize(payload), 'utf8'),
    keyPair.privateKey,
  );
  return {
    format: 'zhiyuan-license-v1',
    keyId: 'license-prod-1',
    payload,
    signature: signature.toString('base64url'),
  };
}
