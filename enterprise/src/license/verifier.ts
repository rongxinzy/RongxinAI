import crypto from 'node:crypto';

import { canonicalize, sha256Digest } from './canonical.js';
import {
  type LicenseClaims,
  LicenseEdition,
  type LicenseEnvelope,
  LicenseFormat,
  LicenseInvalidReason,
  LicenseStatus,
  type LicenseVerificationOptions,
  type LicenseVerificationResult,
} from './types.js';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_LICENSE_BYTES = 64 * 1024;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function verifyLicense(
  input: string | unknown,
  options: LicenseVerificationOptions,
): LicenseVerificationResult {
  const envelope = parseLicenseEnvelope(input);
  if (!envelope) return invalid(LicenseInvalidReason.Malformed);

  const publicKeyEncoded = options.trustedKeys[envelope.keyId];
  if (!publicKeyEncoded) return invalid(LicenseInvalidReason.UnknownKey);

  if (!verifySignature(envelope, publicKeyEncoded)) {
    return invalid(LicenseInvalidReason.InvalidSignature);
  }

  if (
    options.expectedDeploymentId !== undefined &&
    envelope.payload.deploymentId !== options.expectedDeploymentId
  ) {
    return invalid(LicenseInvalidReason.DeploymentMismatch);
  }

  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const notBeforeMs = Date.parse(envelope.payload.notBefore ?? envelope.payload.issuedAt);
  const expiresMs = Date.parse(envelope.payload.expiresAt);
  const graceEndsMs = expiresMs + envelope.payload.graceDays * 24 * 60 * 60 * 1_000;
  if (nowMs < notBeforeMs) return invalid(LicenseInvalidReason.NotYetValid);

  const status =
    nowMs <= expiresMs
      ? LicenseStatus.Active
      : nowMs <= graceEndsMs
        ? LicenseStatus.Grace
        : LicenseStatus.Expired;
  return {
    status,
    envelope,
    digest: sha256Digest(envelope),
    graceEndsAt: new Date(graceEndsMs).toISOString(),
  };
}

export function parseLicenseEnvelope(input: string | unknown): LicenseEnvelope | null {
  let value: unknown = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_LICENSE_BYTES) return null;
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  if (value.format !== LicenseFormat.V1 || typeof value.keyId !== 'string') return null;
  if (!value.keyId || typeof value.signature !== 'string' || !value.signature) return null;
  if (!isRecord(value.payload)) return null;
  const payload = parseClaims(value.payload);
  if (!payload) return null;
  return Object.freeze({
    format: LicenseFormat.V1,
    keyId: value.keyId,
    payload,
    signature: value.signature,
  });
}

function parseClaims(value: Record<string, unknown>): LicenseClaims | null {
  if (
    typeof value.licenseId !== 'string' ||
    typeof value.customerId !== 'string' ||
    typeof value.deploymentId !== 'string' ||
    value.edition !== LicenseEdition.Enterprise ||
    !isTimestamp(value.issuedAt) ||
    !isTimestamp(value.expiresAt) ||
    (value.notBefore !== undefined && !isTimestamp(value.notBefore)) ||
    (value.maintenanceUntil !== undefined && !isTimestamp(value.maintenanceUntil)) ||
    !isNonNegativeInteger(value.graceDays) ||
    !isRecord(value.limits) ||
    !isPositiveInteger(value.limits.users) ||
    !isPositiveInteger(value.limits.agents) ||
    (value.limits.organizations !== undefined && !isPositiveInteger(value.limits.organizations)) ||
    !Array.isArray(value.features) ||
    value.features.some(feature => typeof feature !== 'string' || !feature)
  ) {
    return null;
  }
  const claims: LicenseClaims = {
    licenseId: value.licenseId,
    customerId: value.customerId,
    deploymentId: value.deploymentId,
    edition: LicenseEdition.Enterprise,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    graceDays: value.graceDays,
    limits: {
      users: value.limits.users,
      agents: value.limits.agents,
      ...(value.limits.organizations === undefined
        ? {}
        : { organizations: value.limits.organizations }),
    },
    features: Object.freeze([...value.features]),
    ...(value.notBefore === undefined ? {} : { notBefore: value.notBefore }),
    ...(value.maintenanceUntil === undefined ? {} : { maintenanceUntil: value.maintenanceUntil }),
  };
  if (Date.parse(claims.expiresAt) < Date.parse(claims.issuedAt)) return null;
  return Object.freeze(claims);
}

function verifySignature(envelope: LicenseEnvelope, encodedPublicKey: string): boolean {
  try {
    const publicKeyBytes = decodeBase64Url(encodedPublicKey);
    const signature = decodeBase64Url(envelope.signature);
    if (publicKeyBytes.byteLength !== 32 || signature.byteLength !== 64) return false;
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(
      null,
      Buffer.from(canonicalize(envelope.payload), 'utf8'),
      publicKey,
      signature,
    );
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value.');
  return Buffer.from(
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4),
    'base64',
  );
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(reason: LicenseInvalidReason): LicenseVerificationResult {
  return { status: LicenseStatus.Invalid, reason };
}
