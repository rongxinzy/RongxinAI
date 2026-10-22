/**
 * Shared fixtures for the app update coordinator tests.
 *
 * The signed-manifest builders and the in-memory store are plain helpers, so
 * both the coordinator suite and the install suite can build the same signed
 * release without duplicating the envelope layout.
 */
import crypto from 'node:crypto';
import { vi } from 'vitest';

export class MemoryStore {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

export const updaterInfo = (version: string, sha512: string, filename = 'ZhiYuan.zip') => ({
  version,
  files: [{ url: filename, sha512 }],
  path: filename,
  sha512,
  releaseDate: '2026-08-06T00:00:00.000Z',
});

export function signedManifest(
  privateKey: crypto.KeyObject,
  options: {
    version?: string;
    updaterSha512?: string;
    platform?: string;
    arch?: string;
    variant?: string;
    updaterFilename?: string;
  } = {},
) {
  const version = options.version ?? '2026.7.2';
  const platform = options.platform ?? 'darwin';
  const arch = options.arch ?? 'arm64';
  const variant = options.variant ?? 'default';
  const updaterFilename = options.updaterFilename ?? 'ZhiYuan.zip';
  const payload = {
    channel: 'stable',
    version,
    publishedAt: '2026-08-06T00:00:00.000Z',
    minimumSupportedVersion: '2026.7.1',
    mandatory: false,
    artifact: {
      platform,
      arch,
      variant,
      // The old interface remains a DMG so pre-migration clients still work.
      url: `https://downloads.rongxzyai.com/releases/${version}/${platform}-${arch}-${variant}/ZhiYuan.dmg`,
      size: 1024,
      sha256: 'a'.repeat(64),
      updater: options.updaterSha512
        ? {
            sha512: options.updaterSha512,
            size: 27,
            filename: updaterFilename,
            url: `https://downloads.rongxzyai.com/releases/${version}/${platform}-${arch}-${variant}/${updaterFilename}`,
          }
        : undefined,
    },
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    schemaVersion: 1,
    keyId: 'test-release-key',
    algorithm: 'Ed25519',
    payload: payloadBytes.toString('base64url'),
    signature: crypto.sign(null, payloadBytes, privateKey).toString('base64url'),
  };
}

export function manifestFetch(...envelopes: unknown[]) {
  let call = 0;
  return vi.fn(async () => {
    const envelope = envelopes[Math.min(call, envelopes.length - 1)];
    call += 1;
    return new Response(JSON.stringify(envelope), { status: 200 });
  });
}

/**
 * Moves the clock past the install-time freshness window: only then does a
 * click re-check the manifest instead of installing the ready file directly.
 */
export function ageReadyStatePastFreshnessWindow(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 11 * 60 * 1000);
}
