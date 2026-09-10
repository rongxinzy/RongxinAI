import { safeStorage } from 'electron';

export interface McpCredentialPayload {
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpCredentialKeyValueStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
}

interface EncryptedCredentialPayload {
  version: 1;
  encrypted: string;
}

const MCP_CREDENTIAL_KEY_PREFIX = 'mcp.credentials.';

const hasCredentials = (payload: McpCredentialPayload): boolean =>
  Object.keys(payload.env ?? {}).length > 0 || Object.keys(payload.headers ?? {}).length > 0;

/**
 * Persists MCP secrets encrypted by the operating system's secure storage.
 * SQLite holds only opaque encrypted blobs, never plaintext secret values.
 */
export class McpCredentialVault {
  constructor(private readonly store: McpCredentialKeyValueStore) {}

  get(serverId: string): McpCredentialPayload | undefined {
    const payload = this.getValue<McpCredentialPayload>(this.getKey(serverId));
    if (!payload) return undefined;
    return {
      ...(payload.env ? { env: { ...payload.env } } : {}),
      ...(payload.headers ? { headers: { ...payload.headers } } : {}),
    };
  }

  set(serverId: string, payload: McpCredentialPayload): void {
    if (!hasCredentials(payload)) {
      this.delete(serverId);
      return;
    }
    this.setValue(this.getKey(serverId), payload);
  }

  delete(serverId: string): void {
    this.deleteValue(this.getKey(serverId));
  }

  getValue<T>(key: string): T | undefined {
    const stored = this.store.get<EncryptedCredentialPayload>(key);
    if (!stored) return undefined;
    if (stored.version !== 1 || typeof stored.encrypted !== 'string') {
      throw new Error(
        'Stored MCP secrets are invalid. Re-enter credentials to repair this integration.',
      );
    }
    this.assertAvailable();
    try {
      const parsed = JSON.parse(
        safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')),
      ) as unknown;
      if (parsed === null || parsed === undefined) throw new Error('invalid secret payload');
      return parsed as T;
    } catch (error) {
      throw new Error(
        `Stored MCP secrets cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  setValue<T>(key: string, value: T): void {
    this.assertAvailable();
    const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    this.store.set<EncryptedCredentialPayload>(key, { version: 1, encrypted });
  }

  deleteValue(key: string): void {
    this.store.delete(key);
  }

  private assertAvailable(): void {
    const secureBackendAvailable =
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
    if (!secureBackendAvailable) {
      throw new Error(
        'System secure storage is unavailable. MCP credentials cannot be saved safely.',
      );
    }
  }

  private getKey(serverId: string): string {
    return `${MCP_CREDENTIAL_KEY_PREFIX}${serverId}`;
  }
}
