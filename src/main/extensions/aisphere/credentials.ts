import { safeStorage } from 'electron';

import { AISphere, AISphereError } from '../../../shared/aisphere';

interface CredentialStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

interface EncryptedCredential {
  version: 1;
  encrypted: string;
}

function assertSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error(AISphereError.CredentialStorageUnavailable);
  }
}

export function readAISphereCredential(store: CredentialStore): string {
  const stored = store.get<EncryptedCredential>(AISphere.CredentialStoreKey);
  if (!stored) return '';
  if (stored.version !== 1 || typeof stored.encrypted !== 'string') {
    throw new Error(AISphereError.InvalidCredential);
  }
  assertSecureStorage();
  try {
    return safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'));
  } catch {
    throw new Error(AISphereError.InvalidCredential);
  }
}

export function writeAISphereCredential(store: CredentialStore, credential: string): void {
  assertSecureStorage();
  const encrypted = safeStorage.encryptString(credential).toString('base64');
  store.set(AISphere.CredentialStoreKey, { version: 1, encrypted });
}
