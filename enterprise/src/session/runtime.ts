import path from 'node:path';

import type { AepClient, AepProtectedStorage } from '@aep/sdk-node';

import { resolveZhiyuanAgentId } from '../agent-id.js';
import { loadZhiyuanEnterpriseConfig } from '../enterprise-config.js';
import type { ZhiyuanEnterpriseHostContext } from '../host-contract.js';
import { ZhiyuanLicenseActivation } from '../license/activation.js';
import { createZhiyuanAepClient, type ZhiyuanPasswordSessionOptions } from './factory.js';
import { ZhiyuanPasswordSession } from './password-session.js';
import {
  ProtectedFileStorage,
  type SafeStorageLike,
  SafeStorageProtector,
} from './protected-file-storage.js';

export interface SessionRuntimeDependencies {
  readonly loadSafeStorage?: () => Promise<SafeStorageLike>;
  readonly createProtectedStorage?: (
    directory: string,
    safeStorage: SafeStorageLike,
  ) => AepProtectedStorage;
  readonly createClient?: (options: ZhiyuanPasswordSessionOptions) => AepClient;
}

export interface ZhiyuanSessionRuntimeComponents {
  readonly session: ZhiyuanPasswordSession;
  readonly client: AepClient;
  readonly agentId: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  readonly licenseActivation: ZhiyuanLicenseActivation | null;
}

export async function createZhiyuanSessionRuntime(
  context: ZhiyuanEnterpriseHostContext,
  dependencies: SessionRuntimeDependencies = {},
): Promise<ZhiyuanPasswordSession> {
  return (await createZhiyuanSessionRuntimeComponents(context, dependencies)).session;
}

export async function createZhiyuanSessionRuntimeComponents(
  context: ZhiyuanEnterpriseHostContext,
  dependencies: SessionRuntimeDependencies = {},
): Promise<ZhiyuanSessionRuntimeComponents> {
  const platform = mapPlatform(context.platform);
  const [config, agentId, safeStorage] = await Promise.all([
    loadZhiyuanEnterpriseConfig(context.paths.resources),
    resolveZhiyuanAgentId(context.paths.userData),
    (dependencies.loadSafeStorage ?? loadElectronSafeStorage)(),
  ]);
  assertSecureStorageBackend(safeStorage, platform);
  const protectedStorage = (dependencies.createProtectedStorage ?? createDefaultProtectedStorage)(
    path.join(context.paths.userData, 'zhiyuan-enterprise', 'secrets'),
    safeStorage,
  );
  // Split AEP deployments serve the agent control protocol (session auth +
  // /aep/v1/user/*) from their own endpoint. A configured URL wins; without
  // one, login-time service metadata discovery supplies it — the all-in-one
  // deployment stays on the single base URL.
  let currentBase = config.aepBaseUrl;
  let currentAgentControl = config.agentControlBaseUrl;
  const buildClient = (baseUrl: string) =>
    (dependencies.createClient ?? createZhiyuanAepClient)({
      baseUrl,
      ...(currentAgentControl ? { agentControlBaseUrl: currentAgentControl } : {}),
      agentId,
      agentVersion: context.appVersion,
      platform,
      protectedStorage,
    });
  let activeClient = buildClient(currentBase);
  const client = dependencies.createClient ? activeClient : routeClient(() => activeClient);
  const session = new ZhiyuanPasswordSession(client, (baseUrl, agentControlBaseUrl) => {
    currentBase = baseUrl;
    // `undefined` keeps whatever is already targeted (the packaged config or
    // an earlier discovery); an explicit value re-targets.
    if (agentControlBaseUrl !== undefined) currentAgentControl = agentControlBaseUrl;
    activeClient = buildClient(currentBase);
    return activeClient;
  });
  const licenseActivation = ZhiyuanLicenseActivation.create({ session, client });
  return Object.freeze({
    session,
    client,
    agentId,
    platform,
    licenseActivation,
  });
}

function routeClient<T extends object>(getClient: () => T): T {
  return new Proxy(getClient(), {
    get(_target, property) {
      const value = Reflect.get(getClient(), property, getClient());
      return typeof value === 'function' ? value.bind(getClient()) : value;
    },
  });
}

function assertSecureStorageBackend(
  safeStorage: SafeStorageLike,
  platform: 'windows' | 'macos' | 'linux',
): void {
  if (platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error(
      'Zhiyuan protected storage requires a Linux secret store; the basic_text backend is not permitted.',
    );
  }
}

function createDefaultProtectedStorage(
  directory: string,
  safeStorage: SafeStorageLike,
): AepProtectedStorage {
  return new ProtectedFileStorage(directory, new SafeStorageProtector(safeStorage));
}

async function loadElectronSafeStorage(): Promise<SafeStorageLike> {
  const electron = await import('electron');
  return electron.safeStorage;
}

function mapPlatform(platform: NodeJS.Platform): 'windows' | 'macos' | 'linux' {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  throw new Error(`Zhiyuan enterprise platform ${platform} is not supported.`);
}
