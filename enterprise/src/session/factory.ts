import { createHash } from 'node:crypto';

import {
  type AepClient,
  type AepProtectedStorage,
  type AepTransport,
  ProtectedRefreshTokenStore,
} from '@aep/sdk-node';
import { ZhiyuanSessionAepClient, zhiyuanSessionClientIdentity } from './client-identity.js';
import { ZhiyuanPasswordSession } from './password-session.js';

export interface ZhiyuanPasswordSessionOptions {
  readonly baseUrl: string;
  /**
   * Optional split agent-control endpoint (session auth + /aep/v1/user/*).
   * Omitted, every request uses baseUrl — the all-in-one deployment shape.
   */
  readonly agentControlBaseUrl?: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  readonly protectedStorage: AepProtectedStorage;
  readonly transport?: AepTransport;
}

export function createZhiyuanPasswordSession(
  options: ZhiyuanPasswordSessionOptions,
): ZhiyuanPasswordSession {
  return new ZhiyuanPasswordSession(createZhiyuanAepClient(options));
}

export function createZhiyuanAepClient(options: ZhiyuanPasswordSessionOptions): AepClient {
  const tokenStore = new ProtectedRefreshTokenStore(
    options.protectedStorage,
    refreshTokenStorageKey(options.agentId),
  );
  return new ZhiyuanSessionAepClient(
    {
      baseUrl: options.baseUrl,
      ...(options.agentControlBaseUrl ? { agentControlBaseUrl: options.agentControlBaseUrl } : {}),
      agentId: options.agentId,
      agentVersion: options.agentVersion,
      platform: options.platform,
      tokenStore,
      ...(options.transport ? { transport: options.transport } : {}),
    },
    zhiyuanSessionClientIdentity(options.agentId),
  );
}

function refreshTokenStorageKey(agentId: string): string {
  const digest = createHash('sha256').update(agentId, 'utf8').digest('hex');
  return `aep.refresh-token.${digest}`;
}
