import crypto from 'crypto';

import { APP_UPDATE_TRUSTED_KEYS } from '../../shared/appUpdate/trustedKeys';
import { type UpdatePayload } from './appUpdateManifest';

type SignedManifest = {
  schemaVersion?: unknown;
  keyId?: unknown;
  algorithm?: unknown;
  payload?: unknown;
  signature?: unknown;
};

function base64UrlToBuffer(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value');
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export const verifyAndDecodeUpdateManifest = (value: unknown): UpdatePayload => {
  if (!value || typeof value !== 'object') throw new Error('Invalid update manifest');
  const envelope = value as SignedManifest;
  if (
    envelope.schemaVersion !== 1 ||
    envelope.algorithm !== 'Ed25519' ||
    typeof envelope.keyId !== 'string' ||
    typeof envelope.payload !== 'string' ||
    typeof envelope.signature !== 'string'
  ) {
    throw new Error('Unsupported update manifest');
  }
  const trustedKey = APP_UPDATE_TRUSTED_KEYS[envelope.keyId];
  if (!trustedKey) throw new Error(`Unknown update signing key: ${envelope.keyId}`);
  const payloadBytes = base64UrlToBuffer(envelope.payload);
  const isValid = crypto.verify(
    null,
    payloadBytes,
    crypto.createPublicKey({
      key: Buffer.from(trustedKey, 'base64'),
      format: 'der',
      type: 'spki',
    }),
    base64UrlToBuffer(envelope.signature),
  );
  if (!isValid) throw new Error('Update manifest signature verification failed');
  const payload: unknown = JSON.parse(payloadBytes.toString('utf8'));
  if (!payload || typeof payload !== 'object') throw new Error('Invalid update manifest payload');
  return payload as UpdatePayload;
};
