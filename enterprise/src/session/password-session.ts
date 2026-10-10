import type {
  AepSessionState,
  AepTokens,
  AgentModelList,
  CurrentIdentity,
  EntitlementTokenResponse,
  LicenseActivationRequest,
  ModelConnection,
  ServiceMetadata,
} from '@aep/sdk-node';

export interface PasswordSessionClient {
  getSessionState(): Promise<AepSessionState>;
  restoreSession(): Promise<AepTokens | null>;
  refreshSession(): Promise<AepTokens>;
  getMetadata(): Promise<ServiceMetadata>;
  loginWithPassword(input: {
    deploymentId: string;
    username: string;
    password: string;
  }): Promise<AepTokens>;
  changePassword(currentPassword: string, newPassword: string): Promise<AepTokens>;
  getCurrentIdentity(): Promise<CurrentIdentity>;
  activateEnterpriseLicense?(input: LicenseActivationRequest): Promise<EntitlementTokenResponse>;
  listAgentModels(): Promise<AgentModelList>;
  getModelConnection(): Promise<ModelConnection>;
  logout(): Promise<void>;
}

export type ZhiyuanSessionSnapshot =
  | { readonly status: 'signed-out' }
  | { readonly status: 'recoverable' }
  | { readonly status: 'authenticated'; readonly identity: CurrentIdentity };

export interface PasswordLoginInput {
  readonly aepBaseUrl: string;
  readonly username: string;
  readonly password: string;
}

export class AepMetadataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AepMetadataError';
  }
}

/**
 * Rebuilds the underlying client for a new API base URL. The optional
 * second argument re-targets the agent control protocol surface (split
 * deployments): `undefined` keeps the current target, a string sets it
 * (empty string clears back to the single-base shape).
 */
export type PasswordSessionClientFactory = (
  baseUrl: string,
  agentControlBaseUrl?: string,
) => PasswordSessionClient;

export class ZhiyuanPasswordSession {
  static readonly MODEL_TOKEN_REFRESH_WINDOW_MS = 30_000;
  #client: PasswordSessionClient;
  readonly #clientFactory: PasswordSessionClientFactory | null;
  #snapshot: ZhiyuanSessionSnapshot = Object.freeze({ status: 'signed-out' });
  #initialized = false;
  #initialization: Promise<ZhiyuanSessionSnapshot> | null = null;
  #operationTail: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<() => void | Promise<void>>();
  #modelAccessExpiresAt = 0;
  #discoveredAgentControlBaseUrl: string | null = null;

  constructor(client: PasswordSessionClient, clientFactory?: PasswordSessionClientFactory) {
    this.#client = client;
    this.#clientFactory = clientFactory ?? null;
  }

  snapshot(): ZhiyuanSessionSnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  onDidChange(listener: () => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  initialize(): Promise<ZhiyuanSessionSnapshot> {
    if (this.#initialized) return Promise.resolve(this.snapshot());
    if (this.#initialization) return this.#initialization;

    this.#initialization = this.#enqueue(async () => {
      try {
        const sessionState = await this.#client.getSessionState();
        if (sessionState.status === 'signed-out') {
          this.#snapshot = Object.freeze({ status: 'signed-out' });
        } else if (sessionState.status === 'recoverable') {
          this.#snapshot = Object.freeze({ status: 'recoverable' });
          const tokens = await this.#client.restoreSession();
          if (!tokens) {
            this.#snapshot = Object.freeze({ status: 'signed-out' });
          } else {
            this.#recordTokens(tokens);
            await this.#loadIdentity();
          }
        } else {
          const tokens = await this.#client.restoreSession();
          if (tokens) this.#recordTokens(tokens);
          await this.#loadIdentity();
        }
        this.#initialized = true;
        return this.snapshot();
      } finally {
        await this.#publishChanged();
      }
    }).finally(() => {
      this.#initialization = null;
    });
    return this.#initialization;
  }

  login(input: PasswordLoginInput): Promise<ZhiyuanSessionSnapshot> {
    let aepBaseUrl: string;
    try {
      aepBaseUrl = validateLogin(input);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(async () => {
      // Re-target the entered server before discovery: metadata must come
      // from the deployment the user typed, not the previously configured
      // one. `undefined` keeps the current agent-control target until
      // discovery re-confirms it for this base URL.
      if (this.#clientFactory) {
        this.#client = this.#clientFactory(aepBaseUrl, undefined);
      }
      const deploymentId = await this.#resolveDeploymentId();
      if (this.#clientFactory && this.#discoveredAgentControlBaseUrl) {
        this.#client = this.#clientFactory(aepBaseUrl, this.#discoveredAgentControlBaseUrl);
      }
      const tokens = await this.#client.loginWithPassword({
        deploymentId,
        username: input.username,
        password: input.password,
      });
      this.#recordTokens(tokens);
      this.#initialized = true;
      try {
        await this.#loadIdentityOrMarkRecoverable();
        return this.snapshot();
      } finally {
        await this.#publishChanged();
      }
    });
  }

  changePassword(currentPassword: string, newPassword: string): Promise<ZhiyuanSessionSnapshot> {
    if (!currentPassword || !newPassword) {
      return Promise.reject(new Error('Current and new passwords are required.'));
    }
    return this.#enqueue(async () => {
      const tokens = await this.#client.changePassword(currentPassword, newPassword);
      this.#recordTokens(tokens);
      try {
        await this.#loadIdentityOrMarkRecoverable();
        return this.snapshot();
      } finally {
        await this.#publishChanged();
      }
    });
  }

  logout(): Promise<ZhiyuanSessionSnapshot> {
    return this.#enqueue(async () => {
      await this.#client.logout();
      this.#snapshot = Object.freeze({ status: 'signed-out' });
      this.#modelAccessExpiresAt = 0;
      this.#initialized = true;
      await this.#publishChanged();
      return this.snapshot();
    });
  }

  listAgentModels(): Promise<AgentModelList> {
    return this.#enqueue(async () => {
      if (this.#snapshot.status !== 'authenticated') return { models: [] };
      return this.#client.listAgentModels();
    });
  }

  getModelConnection(): Promise<ModelConnection> {
    return this.#enqueue(async () => {
      if (this.#snapshot.status !== 'authenticated') {
        throw new Error('Zhiyuan enterprise session is not authenticated.');
      }
      if (
        this.#modelAccessExpiresAt <=
        Date.now() + ZhiyuanPasswordSession.MODEL_TOKEN_REFRESH_WINDOW_MS
      ) {
        this.#recordTokens(await this.#client.refreshSession());
      }
      return this.#client.getModelConnection();
    });
  }

  async #resolveDeploymentId(): Promise<string> {
    let metadata: ServiceMetadata;
    try {
      metadata = await this.#client.getMetadata();
    } catch (error) {
      throw new AepMetadataError('AEP server metadata could not be retrieved.', { cause: error });
    }
    const deploymentId = metadata.deploymentId ?? metadata.deployment?.id;
    if (!deploymentId) {
      throw new AepMetadataError('AEP server metadata did not include a deployment ID.');
    }
    // Split deployments advertise the agent control endpoint through
    // metadata; remembered so the login rebuild targets it. A configured
    // endpoint already routes there, and re-targeting is idempotent anyway.
    const agentControl = (metadata as { agentControl?: { baseUrl?: string } }).agentControl
      ?.baseUrl;
    this.#discoveredAgentControlBaseUrl =
      typeof agentControl === 'string' && agentControl !== '' ? agentControl : null;
    return deploymentId;
  }

  async #loadIdentityOrMarkRecoverable(): Promise<void> {
    try {
      await this.#loadIdentity();
    } catch (error) {
      this.#snapshot = Object.freeze({ status: 'recoverable' });
      throw error;
    }
  }

  async #loadIdentity(): Promise<void> {
    const identity = await this.#client.getCurrentIdentity();
    this.#snapshot = Object.freeze({
      status: 'authenticated',
      identity: cloneIdentity(identity),
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #publishChanged(): Promise<void> {
    await Promise.all(
      [...this.#listeners].map(async listener => {
        try {
          await listener();
        } catch {
          // Session operations must not fail because a projection listener failed.
        }
      }),
    );
  }

  #recordTokens(tokens: AepTokens): void {
    this.#modelAccessExpiresAt = Date.now() + Math.max(0, tokens.modelAccessExpiresIn) * 1_000;
  }
}

function validateLogin(input: PasswordLoginInput): string {
  if (!input.aepBaseUrl || !input.username || !input.password) {
    throw new Error('AEP server URL, username, and password are required.');
  }
  let url: URL;
  try {
    url = new URL(input.aepBaseUrl);
  } catch (error) {
    throw new Error('AEP server URL is invalid.', { cause: error });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('AEP server URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('AEP server URL must not contain credentials, query, or fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}

function cloneSnapshot(snapshot: ZhiyuanSessionSnapshot): ZhiyuanSessionSnapshot {
  if (snapshot.status !== 'authenticated') return Object.freeze({ ...snapshot });
  return Object.freeze({ status: 'authenticated', identity: cloneIdentity(snapshot.identity) });
}

function cloneIdentity(identity: CurrentIdentity): CurrentIdentity {
  return Object.freeze({
    ...identity,
    user: Object.freeze({ ...identity.user }),
    enterprise: Object.freeze({ ...identity.enterprise }),
    roles: Object.freeze([...identity.roles]) as string[],
  });
}
