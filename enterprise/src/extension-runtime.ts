import path from 'node:path';

import {
  createZhiyuanAgentControlBackend,
  type ZhiyuanAgentControlBackendOptions,
} from './agent-control/factory.js';
import {
  type AgentControlLifecycleBackend,
  ZhiyuanAgentControlLifecycle,
} from './agent-control/lifecycle.js';
import type { ZhiyuanEnterpriseHostContext } from './host-contract.js';
import type { ZhiyuanLicenseActivation } from './license/activation.js';
import type { ZhiyuanPasswordSession } from './session/password-session.js';
import {
  createZhiyuanSessionRuntimeComponents,
  type SessionRuntimeDependencies,
} from './session/runtime.js';

export interface ZhiyuanExtensionRuntime {
  readonly session: ZhiyuanPasswordSession;
  readonly licenseActivation?: ZhiyuanLicenseActivation | null;
  dispose(): Promise<void>;
}

export interface ZhiyuanExtensionRuntimeDependencies extends SessionRuntimeDependencies {
  readonly createAgentControlBackend?: (
    options: ZhiyuanAgentControlBackendOptions,
  ) => AgentControlLifecycleBackend;
  readonly onControlError?: (error: unknown) => void;
}

export async function createZhiyuanExtensionRuntime(
  context: ZhiyuanEnterpriseHostContext,
  dependencies: ZhiyuanExtensionRuntimeDependencies = {},
): Promise<ZhiyuanExtensionRuntime> {
  const components = await createZhiyuanSessionRuntimeComponents(context, dependencies);
  const skillCapability = context.capabilities.skills;
  if (!skillCapability) {
    components.licenseActivation?.start();
    return Object.freeze({
      session: components.session,
      licenseActivation: components.licenseActivation,
      dispose: async () => components.licenseActivation?.stop(),
    });
  }

  const registration = skillCapability.registerManagedRoot();
  let backend: AgentControlLifecycleBackend;
  try {
    backend = (dependencies.createAgentControlBackend ?? createZhiyuanAgentControlBackend)({
      client: components.client,
      databasePath: path.join(context.paths.userData, 'zhiyuan-enterprise', 'agent-control.sqlite'),
      skillRoot: registration.directory,
      agentVersion: context.appVersion,
      platform: components.platform,
      onSkillsChanged: () => registration.notifyChanged(),
      onError: dependencies.onControlError ?? defaultControlErrorHandler,
    });
  } catch (error) {
    registration.unregister();
    throw error;
  }

  const lifecycle = new ZhiyuanAgentControlLifecycle(components.session, backend);
  components.licenseActivation?.start();
  let disposePromise: Promise<void> | null = null;
  return Object.freeze({
    session: components.session,
    licenseActivation: components.licenseActivation,
    dispose: () => {
      if (disposePromise) return disposePromise;
      disposePromise = lifecycle.dispose().finally(() => {
        components.licenseActivation?.stop();
        registration.unregister();
      });
      return disposePromise;
    },
  });
}

function defaultControlErrorHandler(error: unknown): void {
  void error;
  console.warn('[ZhiyuanAgentControl] Background synchronization failed and will retry.');
}
