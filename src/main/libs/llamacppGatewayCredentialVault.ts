import { randomBytes } from 'node:crypto';

import { McpCredentialVault, type McpCredentialKeyValueStore } from './mcpCredentialVault';

const LLAMACPP_GATEWAY_CREDENTIAL_KEY = 'llamacpp.gateway.credentials';
const LLAMACPP_GATEWAY_TOKEN_BYTES = 32;

type LlamaCppGatewayCredentials = {
  lanToken: string;
  controlToken?: string;
};

/** Stores the LAN gateway secret in OS-backed encrypted storage. */
export class LlamaCppGatewayCredentialVault {
  private readonly vault: McpCredentialVault;

  constructor(store: McpCredentialKeyValueStore) {
    this.vault = new McpCredentialVault(store);
  }

  getLanToken(): string | null {
    return this.vault.getValue<LlamaCppGatewayCredentials>(LLAMACPP_GATEWAY_CREDENTIAL_KEY)?.lanToken ?? null;
  }

  ensureLanToken(): string {
    return this.getLanToken() ?? this.regenerateLanToken();
  }

  regenerateLanToken(): string {
    const credentials = this.vault.getValue<LlamaCppGatewayCredentials>(
      LLAMACPP_GATEWAY_CREDENTIAL_KEY,
    );
    const lanToken = randomBytes(LLAMACPP_GATEWAY_TOKEN_BYTES).toString('base64url');
    this.vault.setValue<LlamaCppGatewayCredentials>(LLAMACPP_GATEWAY_CREDENTIAL_KEY, {
      ...credentials,
      lanToken,
    });
    return lanToken;
  }

  ensureControlToken(): string {
    const credentials = this.vault.getValue<LlamaCppGatewayCredentials>(
      LLAMACPP_GATEWAY_CREDENTIAL_KEY,
    );
    if (credentials?.controlToken) return credentials.controlToken;
    const controlToken = randomBytes(LLAMACPP_GATEWAY_TOKEN_BYTES).toString('base64url');
    this.vault.setValue<LlamaCppGatewayCredentials>(LLAMACPP_GATEWAY_CREDENTIAL_KEY, {
      ...(credentials ?? { lanToken: randomBytes(LLAMACPP_GATEWAY_TOKEN_BYTES).toString('base64url') }),
      controlToken,
    });
    return controlToken;
  }
}
