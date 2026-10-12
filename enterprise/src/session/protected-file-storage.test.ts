import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type AepTokens, ProtectedRefreshTokenStore } from '@aep/sdk-node';
import { afterEach, describe, expect, test } from 'vitest';

import {
  ProtectedFileStorage,
  SafeStorageProtector,
  type SecretProtector,
} from './protected-file-storage.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan protected file storage', () => {
  test('atomically replaces encrypted values without persisting plaintext', async () => {
    const directory = createTemporaryDirectory();
    const storage = new ProtectedFileStorage(directory, xorProtector());
    const first = new TextEncoder().encode('first-refresh-secret');
    const second = new TextEncoder().encode('second-refresh-secret');

    await storage.write('aep.refresh-token.agent-1', first);
    expect(new TextDecoder().decode(first)).toBe('first-refresh-secret');
    expect(await storage.read('aep.refresh-token.agent-1')).toEqual(first);

    await storage.write('aep.refresh-token.agent-1', second);
    const persisted = fs.readFileSync(path.join(directory, 'aep.refresh-token.agent-1.bin'));
    expect(persisted.includes(Buffer.from('first-refresh-secret'))).toBe(false);
    expect(persisted.includes(Buffer.from('second-refresh-secret'))).toBe(false);
    expect(await storage.read('aep.refresh-token.agent-1')).toEqual(second);

    await storage.remove('aep.refresh-token.agent-1');
    await expect(storage.read('aep.refresh-token.agent-1')).resolves.toBeNull();
  });

  test('round-trips the SDK refresh token without persisting access tokens', async () => {
    const directory = createTemporaryDirectory();
    const protectedStorage = new ProtectedFileStorage(directory, xorProtector());
    const tokenStore = new ProtectedRefreshTokenStore(
      protectedStorage,
      'aep.refresh-token.agent-2',
    );

    await tokenStore.set(tokens('refresh-one'));
    expect(await tokenStore.get()).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-one',
    });

    const restoredStore = new ProtectedRefreshTokenStore(
      protectedStorage,
      'aep.refresh-token.agent-2',
    );
    expect(await restoredStore.get()).toBeNull();
    expect(await restoredStore.getRefreshToken()).toBe('refresh-one');

    const persisted = fs.readFileSync(path.join(directory, 'aep.refresh-token.agent-2.bin'));
    expect(persisted.includes(Buffer.from('access-token'))).toBe(false);
    expect(persisted.includes(Buffer.from('model-token'))).toBe(false);
  });

  test('rejects path traversal and unavailable platform encryption', async () => {
    const directory = createTemporaryDirectory();
    const storage = new ProtectedFileStorage(directory, xorProtector());
    await expect(storage.write('../escape', new Uint8Array([1]))).rejects.toThrow('key is invalid');

    const protector = new SafeStorageProtector({
      isEncryptionAvailable: () => false,
      getSelectedStorageBackend: () => 'unknown',
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    });
    await expect(protector.protect(new Uint8Array([1]))).rejects.toThrow('unavailable');
  });

  test('adapts platform safe storage without retaining its mutable buffers', async () => {
    const protector = new SafeStorageProtector({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'dpapi',
      encryptString: value => Buffer.from(`protected:${value}`, 'utf8'),
      decryptString: value => value.toString('utf8').replace(/^protected:/, ''),
    });
    const plainText = new TextEncoder().encode('refresh-secret');

    const encrypted = await protector.protect(plainText);
    expect(new TextDecoder().decode(encrypted)).toBe('protected:refresh-secret');
    expect(await protector.unprotect(encrypted)).toEqual(plainText);
  });
});

function xorProtector(): SecretProtector {
  const transform = async (value: Uint8Array) => Uint8Array.from(value, byte => byte ^ 0xa5);
  return { protect: transform, unprotect: transform };
}

function tokens(refreshToken: string): AepTokens {
  return {
    accessToken: 'access-token',
    refreshToken,
    modelAccessToken: 'model-token',
    tokenType: 'Bearer',
    expiresIn: 900,
    modelAccessExpiresIn: 300,
    passwordChangeRequired: false,
  };
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-protected-storage-'));
  temporaryDirectories.push(directory);
  return directory;
}
