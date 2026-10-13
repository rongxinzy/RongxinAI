import {
  createZhiyuanExtensionRuntime,
  type ZhiyuanExtensionRuntime,
} from './extension-runtime.js';
import {
  ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
  ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION,
  ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION,
  ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION,
  ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION,
  ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION,
  type ZhiyuanEnterpriseExtension,
  type ZhiyuanEnterpriseHostContext,
} from './host-contract.js';
import { ZhiyuanModelProvider } from './models/provider.js';
import type { ZhiyuanPasswordSession } from './session/password-session.js';
import { ZhiyuanPasswordSessionProvider } from './session/provider.js';
import { createZhiyuanSessionRuntime } from './session/runtime.js';

export const ZHIYUAN_ENTERPRISE_EXTENSION_ID = 'zhiyuan.aaas';
export const ZHIYUAN_ENTERPRISE_SESSION_GATE_ENTRYPOINT = 'ui/index.html';
export const ZHIYUAN_ENTERPRISE_SETTINGS_ENTRYPOINT = 'ui/index.html';
export const ZHIYUAN_ENTERPRISE_SETTINGS_PAGES = Object.freeze([
  Object.freeze({
    id: 'account',
    entrypoint: ZHIYUAN_ENTERPRISE_SETTINGS_ENTRYPOINT,
    labels: Object.freeze({ zh: '企业账户', en: 'Enterprise account' }),
  }),
  Object.freeze({
    id: 'models',
    entrypoint: ZHIYUAN_ENTERPRISE_SETTINGS_ENTRYPOINT,
    labels: Object.freeze({ zh: '企业模型', en: 'Enterprise models' }),
  }),
]);

type ExtensionState =
  | { readonly status: 'idle' }
  | { readonly status: 'active'; readonly context: ZhiyuanEnterpriseHostContext }
  | { readonly status: 'disposed' };

export interface ZhiyuanExtensionDependencies {
  readonly createRuntime?: (
    context: ZhiyuanEnterpriseHostContext,
  ) => Promise<ZhiyuanExtensionRuntime>;
  readonly createSession?: (
    context: ZhiyuanEnterpriseHostContext,
  ) => Promise<ZhiyuanPasswordSession>;
  readonly warn: (message: string) => void;
}

const defaultDependencies: ZhiyuanExtensionDependencies = {
  createRuntime: createZhiyuanExtensionRuntime,
  warn: message => console.warn(message),
};

export class ZhiyuanAaaSExtension implements ZhiyuanEnterpriseExtension {
  readonly apiVersion = ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION;
  readonly id = ZHIYUAN_ENTERPRISE_EXTENSION_ID;
  readonly #dependencies: ZhiyuanExtensionDependencies;
  #state: ExtensionState = { status: 'idle' };
  #unregisterSessionProvider: (() => void) | null = null;
  #unregisterSessionGate: (() => void) | null = null;
  #unregisterSettingsPages: Array<() => void> = [];
  #unregisterManagedProvider: (() => void) | null = null;
  #runtime: ZhiyuanExtensionRuntime | null = null;

  constructor(dependencies: ZhiyuanExtensionDependencies = defaultDependencies) {
    this.#dependencies = dependencies;
  }

  async initialize(context: ZhiyuanEnterpriseHostContext): Promise<void> {
    if (this.#state.status !== 'idle') {
      throw new Error(`Zhiyuan enterprise extension cannot initialize from ${this.#state.status}.`);
    }
    if (context.apiVersion !== ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION) {
      throw new Error('Zhiyuan enterprise extension host API version is not supported.');
    }
    const sessionCapability = context.capabilities.session;
    const rendererCapability = context.capabilities.renderer;
    const settingsCapability = context.capabilities.settings;
    const managedProviderCapability = context.capabilities.managedProvider;
    const skillCapability = context.capabilities.skills;
    if (
      sessionCapability &&
      sessionCapability.apiVersion !== ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION
    ) {
      throw new Error('Zhiyuan enterprise session capability API version is not supported.');
    }
    if (
      rendererCapability &&
      rendererCapability.apiVersion !== ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION
    ) {
      throw new Error('Zhiyuan enterprise renderer capability API version is not supported.');
    }
    if (
      settingsCapability &&
      settingsCapability.apiVersion !== ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION
    ) {
      throw new Error('Zhiyuan enterprise settings capability API version is not supported.');
    }
    if (
      managedProviderCapability &&
      managedProviderCapability.apiVersion < ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION
    ) {
      throw new Error('Zhiyuan managed provider capability API version is not supported.');
    }
    if (
      skillCapability &&
      skillCapability.apiVersion !== ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION
    ) {
      throw new Error('Zhiyuan enterprise Skill capability API version is not supported.');
    }
    if (sessionCapability || managedProviderCapability || skillCapability) {
      const runtime = await this.#createRuntime(context);
      this.#runtime = runtime;
      const session = runtime.session;
      if (sessionCapability) {
        this.#unregisterSessionProvider = sessionCapability.registerProvider(
          new ZhiyuanPasswordSessionProvider(session),
        );
      }
      if (managedProviderCapability) {
        this.#unregisterManagedProvider = managedProviderCapability.registerSource(
          new ZhiyuanModelProvider(session, {
            hostManagedProviderApiVersion: managedProviderCapability.apiVersion,
            getEntitlementToken: () =>
              runtime.licenseActivation?.entitlement()?.entitlementToken ?? null,
            requireEntitlement:
              runtime.licenseActivation !== null && runtime.licenseActivation !== undefined,
            ...(runtime.licenseActivation
              ? {
                  onEntitlementChange: (listener: () => void) =>
                    runtime.licenseActivation!.onDidChange(listener),
                  refreshEntitlement: () => runtime.licenseActivation!.refreshIfNeeded(),
                }
              : {}),
          }),
        );
      }
      await session.initialize().catch(() => {
        this.#dependencies.warn(
          '[EnterpriseSession] Session restoration could not complete and remains retryable.',
        );
      });
    }
    if (rendererCapability) {
      this.#unregisterSessionGate = rendererCapability.registerSessionGate(
        ZHIYUAN_ENTERPRISE_SESSION_GATE_ENTRYPOINT,
      );
    }
    if (settingsCapability) {
      try {
        for (const page of ZHIYUAN_ENTERPRISE_SETTINGS_PAGES) {
          this.#unregisterSettingsPages.push(settingsCapability.registerPage(page));
        }
      } catch (error) {
        for (const unregister of this.#unregisterSettingsPages.reverse()) unregister();
        this.#unregisterSettingsPages = [];
        throw error;
      }
    }
    this.#state = { status: 'active', context };
  }

  async dispose(): Promise<void> {
    this.#unregisterManagedProvider?.();
    this.#unregisterManagedProvider = null;
    for (const unregister of this.#unregisterSettingsPages.reverse()) unregister();
    this.#unregisterSettingsPages = [];
    this.#unregisterSessionGate?.();
    this.#unregisterSessionGate = null;
    this.#unregisterSessionProvider?.();
    this.#unregisterSessionProvider = null;
    const runtime = this.#runtime;
    this.#runtime = null;
    await runtime?.dispose();
    this.#state = { status: 'disposed' };
  }

  async #createRuntime(context: ZhiyuanEnterpriseHostContext): Promise<ZhiyuanExtensionRuntime> {
    if (this.#dependencies.createRuntime) {
      return this.#dependencies.createRuntime(context);
    }
    const session = await (this.#dependencies.createSession ?? createZhiyuanSessionRuntime)(
      context,
    );
    return Object.freeze({ session, dispose: async () => undefined });
  }
}

export function createZhiyuanEnterpriseExtension(): ZhiyuanEnterpriseExtension {
  return new ZhiyuanAaaSExtension();
}

export {
  createZhiyuanAgentControlBackend,
  ZhiyuanAgentControlBackend,
  type ZhiyuanAgentControlBackendOptions,
} from './agent-control/factory.js';
export {
  createZhiyuanExtensionRuntime,
  type ZhiyuanExtensionRuntime,
  type ZhiyuanExtensionRuntimeDependencies,
} from './extension-runtime.js';
export { ZhiyuanLicenseActivation } from './license/activation.js';
export { canonicalize, sha256Digest } from './license/canonical.js';
export { ZhiyuanLicenseStateMachine } from './license/state.js';
export * from './license/types.js';
export { parseLicenseEnvelope, verifyLicense } from './license/verifier.js';
export { createZhiyuanPasswordSession } from './session/factory.js';
