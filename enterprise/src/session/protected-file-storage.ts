import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { AepProtectedStorage } from '@aep/sdk-node';

const STORAGE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export interface SecretProtector {
  protect(value: Uint8Array): Promise<Uint8Array>;
  unprotect(value: Uint8Array): Promise<Uint8Array>;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encryptedValue: Buffer): string;
}

export class SafeStorageProtector implements SecretProtector {
  readonly #safeStorage: SafeStorageLike;

  constructor(safeStorage: SafeStorageLike) {
    this.#safeStorage = safeStorage;
  }

  async protect(value: Uint8Array): Promise<Uint8Array> {
    this.#assertAvailable();
    const plainText = new TextDecoder('utf-8', { fatal: true }).decode(value);
    const encrypted = this.#safeStorage.encryptString(plainText);
    try {
      return Uint8Array.from(encrypted);
    } finally {
      encrypted.fill(0);
    }
  }

  async unprotect(value: Uint8Array): Promise<Uint8Array> {
    this.#assertAvailable();
    const encrypted = Buffer.from(value);
    try {
      return new TextEncoder().encode(this.#safeStorage.decryptString(encrypted));
    } finally {
      encrypted.fill(0);
    }
  }

  #assertAvailable(): void {
    if (!this.#safeStorage.isEncryptionAvailable()) {
      throw new Error('Zhiyuan protected storage is unavailable on this system.');
    }
  }
}

export class ProtectedFileStorage implements AepProtectedStorage {
  readonly #directory: string;
  readonly #protector: SecretProtector;

  constructor(directory: string, protector: SecretProtector) {
    if (!path.isAbsolute(directory)) {
      throw new Error('Zhiyuan protected storage directory must be absolute.');
    }
    this.#directory = path.resolve(directory);
    this.#protector = protector;
  }

  async read(key: string): Promise<Uint8Array | null> {
    const filePath = this.#filePath(key);
    let encrypted: Buffer;
    try {
      const metadata = await fs.lstat(filePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error('Zhiyuan protected storage entry is not a regular file.');
      }
      encrypted = await fs.readFile(filePath);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      throw error;
    }

    try {
      const plainText = await this.#protector.unprotect(encrypted);
      try {
        return Uint8Array.from(plainText);
      } finally {
        plainText.fill(0);
      }
    } finally {
      encrypted.fill(0);
    }
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    const filePath = this.#filePath(key);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const plainText = Uint8Array.from(value);
    let encrypted: Uint8Array | null = null;
    try {
      encrypted = await this.#protector.protect(plainText);
      await fs.mkdir(this.#directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temporaryPath, encrypted, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporaryPath, filePath);
      await fs.chmod(filePath, 0o600);
    } finally {
      plainText.fill(0);
      encrypted?.fill(0);
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.#filePath(key), { force: true });
  }

  #filePath(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new Error('Zhiyuan protected storage key is invalid.');
    }
    return path.join(this.#directory, `${key}.bin`);
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
