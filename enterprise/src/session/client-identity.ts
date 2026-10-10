import {
  AepClient,
  type AepClientOptions,
  AepProblem,
  type AepTokens,
  type ClientIdentity,
  type HeartbeatResponse,
  type JsonObject,
} from '@aep/sdk-node';

import extensionManifest from '../../extension-manifest.json' with { type: 'json' };

export const ZHIYUAN_SESSION_CLIENT_NAME = 'zhiyuan-enterprise';
// The extension version is pinned in enterprise/extension-manifest.json and
// inlined into the bundle at build time.
export const ZHIYUAN_SESSION_CLIENT_VERSION: string = extensionManifest.extension.version;

export function zhiyuanSessionClientIdentity(deviceId: string): ClientIdentity {
  return {
    name: ZHIYUAN_SESSION_CLIENT_NAME,
    version: ZHIYUAN_SESSION_CLIENT_VERSION,
    deviceId,
  };
}

// Servers predating session client identity decode request bodies with
// DisallowUnknownFields, so an unknown `client` key is the only 400
// INVALID_REQUEST an SDK-constructed login or heartbeat body can produce.
export function isUnknownSessionClientProblem(error: unknown): boolean {
  return error instanceof AepProblem && error.status === 400 && error.code === 'INVALID_REQUEST';
}

// AEP client that self-reports the extension client identity on password login
// and heartbeat. Support is probed lazily per server: the first request carries
// the identity, a 400 INVALID_REQUEST marks the server as too old and the
// request is retried once without the field. Heartbeats only keep carrying the
// identity while the server accepts it.
export class ZhiyuanSessionAepClient extends AepClient {
  readonly #identity: ClientIdentity;
  #clientIdentitySupported: boolean | null = null;

  constructor(options: AepClientOptions, identity: ClientIdentity) {
    super(options);
    this.#identity = identity;
  }

  override async loginWithPassword(
    input: Parameters<AepClient['loginWithPassword']>[0],
  ): Promise<AepTokens> {
    if (this.#clientIdentitySupported === false) return super.loginWithPassword(input);
    try {
      const tokens = await super.loginWithPassword({
        ...input,
        client: input.client ?? this.#identity,
      });
      this.#clientIdentitySupported = true;
      return tokens;
    } catch (error) {
      if (!isUnknownSessionClientProblem(error)) throw error;
      this.#clientIdentitySupported = false;
      return super.loginWithPassword(input);
    }
  }

  override async heartbeat(input: JsonObject): Promise<HeartbeatResponse> {
    if (this.#clientIdentitySupported === false) return super.heartbeat(input);
    try {
      const response = await super.heartbeat({
        ...input,
        client: clientIdentityJson(this.#identity),
      });
      this.#clientIdentitySupported = true;
      return response;
    } catch (error) {
      if (!isUnknownSessionClientProblem(error)) throw error;
      this.#clientIdentitySupported = false;
      return super.heartbeat(input);
    }
  }
}

function clientIdentityJson(identity: ClientIdentity): JsonObject {
  const client: JsonObject = { name: identity.name };
  if (identity.version) client.version = identity.version;
  if (identity.deviceId) client.deviceId = identity.deviceId;
  return client;
}
