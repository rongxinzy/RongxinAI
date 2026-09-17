import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { LlamaCppGatewayCredentialVault } from './llamacppGatewayCredentialVault';

const createStore = () => {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: <T>(key: string, value: T) => values.set(key, value),
    delete: (key: string) => values.delete(key),
  };
};

test('preserves the daemon control token when rotating the LAN token', () => {
  const vault = new LlamaCppGatewayCredentialVault(createStore());
  const controlToken = vault.ensureControlToken();
  const previousLanToken = vault.getLanToken();

  const lanToken = vault.regenerateLanToken();

  expect(lanToken).not.toBe(previousLanToken);
  expect(vault.getLanToken()).toBe(lanToken);
  expect(vault.ensureControlToken()).toBe(controlToken);
});
