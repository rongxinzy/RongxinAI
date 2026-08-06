import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { compare, valid } from 'semver';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function base64UrlToBuffer(value) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) {
    throw new Error('Invalid base64url value in update manifest');
  }
  return Buffer.from(value, 'base64url');
}

export function loadTrustedReleaseKey() {
  const keyId = process.env.UPDATE_MANIFEST_KEY_ID;
  const publicKeyBase64 = process.env.UPDATE_MANIFEST_PUBLIC_KEY_BASE64;
  if (!keyId || !publicKeyBase64) {
    throw new Error('UPDATE_MANIFEST_KEY_ID and UPDATE_MANIFEST_PUBLIC_KEY_BASE64 are required');
  }
  return {
    keyId,
    publicKey: crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    }),
  };
}

export function verifyEnvelope(envelope, trustedKey = loadTrustedReleaseKey()) {
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    envelope.schemaVersion !== 1 ||
    envelope.keyId !== trustedKey.keyId ||
    envelope.algorithm !== 'Ed25519' ||
    typeof envelope.payload !== 'string' ||
    typeof envelope.signature !== 'string'
  ) {
    throw new Error('Unsupported signed update manifest');
  }

  const payloadBytes = base64UrlToBuffer(envelope.payload);
  const signature = base64UrlToBuffer(envelope.signature);
  if (!crypto.verify(null, payloadBytes, trustedKey.publicKey, signature)) {
    throw new Error('Update manifest signature verification failed');
  }

  const payload = JSON.parse(payloadBytes.toString('utf8'));
  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.channel !== 'stable' ||
    typeof payload.version !== 'string' ||
    !valid(payload.version) ||
    !payload.artifact ||
    typeof payload.artifact !== 'object'
  ) {
    throw new Error('Update manifest payload failed validation');
  }
  return payload;
}

export async function readAndVerifyCollection(filePath, trustedKey = loadTrustedReleaseKey()) {
  const collection = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (
    !collection ||
    typeof collection !== 'object' ||
    collection.schemaVersion !== 1 ||
    !Array.isArray(collection.manifests) ||
    collection.manifests.length === 0
  ) {
    throw new Error(`Invalid update manifest collection: ${filePath}`);
  }
  return collection.manifests.map(envelope => ({
    envelope,
    payload: verifyEnvelope(envelope, trustedKey),
  }));
}

export function collectionVersion(entries) {
  const versions = new Set(entries.map(entry => entry.payload.version));
  if (versions.size !== 1) {
    throw new Error('A stable manifest collection must contain exactly one release version');
  }
  return entries[0].payload.version;
}

export function compareVersions(left, right) {
  if (!valid(left) || !valid(right)) throw new Error('Cannot compare invalid SemVer values');
  return compare(left, right);
}

export function artifactIdentity(payload) {
  const artifact = payload.artifact;
  const updater = artifact.updater;
  const target = `${artifact.platform}:${artifact.arch}:${artifact.variant}`;
  if (
    !artifact.platform ||
    !artifact.arch ||
    !artifact.variant ||
    typeof artifact.url !== 'string' ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0 ||
    typeof artifact.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  ) {
    throw new Error(`Invalid artifact metadata for ${target}`);
  }
  if (
    updater &&
    (typeof updater.filename !== 'string' ||
      !updater.filename ||
      typeof updater.url !== 'string' ||
      !Number.isSafeInteger(updater.size) ||
      updater.size <= 0 ||
      typeof updater.sha512 !== 'string' ||
      !/^[A-Za-z0-9+/]{86}(?:==)?$/.test(updater.sha512))
  ) {
    throw new Error(`Invalid updater artifact metadata for ${target}`);
  }
  return {
    target,
    value: JSON.stringify({
      url: artifact.url,
      size: artifact.size,
      sha256: artifact.sha256,
      updater: updater
        ? {
            filename: updater.filename,
            url: updater.url,
            size: updater.size,
            sha512: updater.sha512,
          }
        : null,
    }),
  };
}

export function referencedObjectKeys(entries) {
  const referenced = new Set();
  for (const entry of entries) {
    const artifactUrls = [entry.payload.artifact.url, entry.payload.artifact.updater?.url].filter(Boolean);
    for (const value of artifactUrls) {
      const artifactUrl = new URL(value);
      if (
        artifactUrl.protocol !== 'https:' ||
        artifactUrl.hostname !== 'downloads.rongxzyai.com' ||
        !artifactUrl.pathname.startsWith('/releases/')
      ) {
        throw new Error(`Unexpected release artifact URL: ${artifactUrl.toString()}`);
      }
      const key = decodeURIComponent(artifactUrl.pathname.slice(1));
      referenced.add(key);
      if (value === entry.payload.artifact.updater?.url && /\.(?:exe|zip)$/i.test(key)) {
        referenced.add(`${key}.blockmap`);
      }
    }
  }
  return referenced;
}

export function writeActionOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  return fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
