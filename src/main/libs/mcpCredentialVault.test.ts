import { expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  encryptionAvailable: true,
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => electronMocks.encryptionAvailable,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { McpCredentialVault } from './mcpCredentialVault';

const createStore = () => {
  const values = new Map<string, unknown>();
  return {
    values,
    store: {
      get: <T>(key: string) => values.get(key) as T | undefined,
      set: <T>(key: string, value: T) => values.set(key, value),
      delete: (key: string) => values.delete(key),
    },
  };
};

test('encrypts MCP credentials before writing them to the key-value store', () => {
  const { store, values } = createStore();
  const vault = new McpCredentialVault(store);

  vault.set('server-1', { headers: { Authorization: 'Bearer secret-token' } });

  const stored = JSON.stringify([...values.values()]);
  expect(stored).not.toContain('Bearer secret-token');
  expect(vault.get('server-1')).toEqual({ headers: { Authorization: 'Bearer secret-token' } });
});

test('refuses to persist MCP credentials when secure storage is unavailable', () => {
  const { store } = createStore();
  const vault = new McpCredentialVault(store);
  electronMocks.encryptionAvailable = false;

  expect(() => vault.set('server-1', { env: { API_TOKEN: 'secret-token' } })).toThrow(
    'System secure storage is unavailable',
  );

  electronMocks.encryptionAvailable = true;
});
