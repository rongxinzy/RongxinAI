import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
  type ZhiyuanEnterpriseExtension,
  type ZhiyuanEnterpriseExtensionModule,
  type ZhiyuanEnterpriseExtensionSnapshot,
  ZhiyuanEnterpriseExtensionStatus,
  type ZhiyuanEnterpriseHostContext,
  type ZhiyuanEnterpriseRendererHostCapability,
  type ZhiyuanEnterpriseSettingsHostCapability,
  type ZhiyuanEnterpriseSessionHostCapability,
  type ZhiyuanEnterpriseSkillHostCapability,
} from './contract';

const ENTERPRISE_RESOURCE_DIRECTORY = 'zhiyuan-enterprise';
const ENTERPRISE_EXTENSION_FILENAME = 'extension.cjs';
const ENTERPRISE_EXTENSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;

export interface ZhiyuanEnterpriseExtensionHostOptions {
  readonly appVersion: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly resourcesPath: string;
  readonly userDataPath: string;
  readonly developmentExtensionPath?: string;
  readonly sessionCapability?: ZhiyuanEnterpriseSessionHostCapability;
  readonly createRendererCapability?: (
    extensionDirectory: string,
  ) => ZhiyuanEnterpriseRendererHostCapability;
  readonly createSettingsCapability?: (
    extensionDirectory: string,
  ) => ZhiyuanEnterpriseSettingsHostCapability;
  readonly createSkillCapability?: () => ZhiyuanEnterpriseSkillHostCapability;
}

type ExtensionModuleImporter = (modulePath: string) => Promise<unknown>;

export class ZhiyuanEnterpriseExtensionHost {
  readonly #importModule: ExtensionModuleImporter;
  #extension: ZhiyuanEnterpriseExtension | null = null;
  #initializePromise: Promise<ZhiyuanEnterpriseExtensionSnapshot> | null = null;
  #disposePromise: Promise<void> | null = null;
  #status: ZhiyuanEnterpriseExtensionStatus = ZhiyuanEnterpriseExtensionStatus.Idle;

  constructor(importModule: ExtensionModuleImporter = importExtensionModule) {
    this.#importModule = importModule;
  }

  snapshot(): ZhiyuanEnterpriseExtensionSnapshot {
    return Object.freeze({
      status: this.#status,
      extensionId: this.#extension?.id ?? null,
    });
  }

  initialize(
    options: ZhiyuanEnterpriseExtensionHostOptions,
  ): Promise<ZhiyuanEnterpriseExtensionSnapshot> {
    if (this.#initializePromise) return this.#initializePromise;
    if (
      this.#status === ZhiyuanEnterpriseExtensionStatus.Active ||
      this.#status === ZhiyuanEnterpriseExtensionStatus.Absent
    ) {
      return Promise.resolve(this.snapshot());
    }
    if (this.#status !== ZhiyuanEnterpriseExtensionStatus.Idle) {
      return Promise.reject(
        new Error(`Zhiyuan enterprise extension cannot initialize from ${this.#status}.`),
      );
    }

    this.#initializePromise = this.#initialize(options).finally(() => {
      this.#initializePromise = null;
    });
    return this.#initializePromise;
  }

  async dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposePromise = (async () => {
      if (this.#initializePromise) {
        try {
          await this.#initializePromise;
        } catch {
          // Initialization already records failure; shutdown still needs to finish.
        }
      }
      await this.#dispose();
    })().finally(() => {
      this.#disposePromise = null;
    });
    return this.#disposePromise;
  }

  async #initialize(
    options: ZhiyuanEnterpriseExtensionHostOptions,
  ): Promise<ZhiyuanEnterpriseExtensionSnapshot> {
    const modulePath = resolveExtensionModulePath(options);
    if (!fs.existsSync(modulePath)) {
      this.#status = ZhiyuanEnterpriseExtensionStatus.Absent;
      return this.snapshot();
    }

    let extension: ZhiyuanEnterpriseExtension | null = null;
    try {
      const imported = await this.#importModule(modulePath);
      const extensionModule = resolveExtensionModule(imported);
      extension = await extensionModule.createZhiyuanEnterpriseExtension();
      validateExtension(extension);
      await extension.initialize(createHostContext(options, path.dirname(modulePath)));
      this.#extension = extension;
      this.#status = ZhiyuanEnterpriseExtensionStatus.Active;
      return this.snapshot();
    } catch (error) {
      if (extension && typeof extension.dispose === 'function') {
        try {
          await extension.dispose();
        } catch (disposeError) {
          this.#status = ZhiyuanEnterpriseExtensionStatus.Failed;
          throw new AggregateError(
            [error, disposeError],
            'Zhiyuan enterprise extension initialization and cleanup failed.',
          );
        }
      }
      this.#status = ZhiyuanEnterpriseExtensionStatus.Failed;
      throw error;
    }
  }

  async #dispose(): Promise<void> {
    const extension = this.#extension;
    this.#extension = null;
    this.#status = ZhiyuanEnterpriseExtensionStatus.Disposed;
    if (extension) await extension.dispose();
  }
}

function resolveExtensionModulePath(options: ZhiyuanEnterpriseExtensionHostOptions): string {
  if (!options.isPackaged && options.developmentExtensionPath) {
    if (!path.isAbsolute(options.developmentExtensionPath)) {
      throw new Error('Zhiyuan enterprise development extension path must be absolute.');
    }
    return path.normalize(options.developmentExtensionPath);
  }
  return path.join(
    path.resolve(options.resourcesPath),
    ENTERPRISE_RESOURCE_DIRECTORY,
    ENTERPRISE_EXTENSION_FILENAME,
  );
}

function resolveExtensionModule(imported: unknown): ZhiyuanEnterpriseExtensionModule {
  const candidate = asRecord(imported);
  const defaultCandidate = asRecord(candidate?.default);
  const factory =
    candidate?.createZhiyuanEnterpriseExtension ??
    defaultCandidate?.createZhiyuanEnterpriseExtension;
  if (typeof factory !== 'function') {
    throw new Error('Zhiyuan enterprise extension module does not export its factory.');
  }
  return { createZhiyuanEnterpriseExtension: () => factory() };
}

function validateExtension(extension: unknown): asserts extension is ZhiyuanEnterpriseExtension {
  const candidate = asRecord(extension);
  if (candidate?.apiVersion !== ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION) {
    throw new Error('Zhiyuan enterprise extension API version is not supported.');
  }
  if (typeof candidate.id !== 'string' || !ENTERPRISE_EXTENSION_ID_PATTERN.test(candidate.id)) {
    throw new Error('Zhiyuan enterprise extension ID is invalid.');
  }
  if (typeof candidate.initialize !== 'function' || typeof candidate.dispose !== 'function') {
    throw new Error('Zhiyuan enterprise extension lifecycle is incomplete.');
  }
}

function createHostContext(
  options: ZhiyuanEnterpriseExtensionHostOptions,
  extensionDirectory: string,
): ZhiyuanEnterpriseHostContext {
  const paths = Object.freeze({
    resources: path.resolve(options.resourcesPath),
    userData: path.resolve(options.userDataPath),
  });
  const capabilities = Object.freeze({
    session: options.sessionCapability ?? null,
    renderer: options.createRendererCapability?.(extensionDirectory) ?? null,
    settings: options.createSettingsCapability?.(extensionDirectory) ?? null,
    skills: options.createSkillCapability?.() ?? null,
  });
  return Object.freeze({
    apiVersion: ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION,
    appVersion: options.appVersion,
    isPackaged: options.isPackaged,
    platform: options.platform,
    paths,
    capabilities,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

async function importExtensionModule(modulePath: string): Promise<unknown> {
  return import(/* @vite-ignore */ pathToFileURL(modulePath).href);
}

const defaultEnterpriseExtensionHost = new ZhiyuanEnterpriseExtensionHost();

export function initializeZhiyuanEnterpriseExtension(
  options: ZhiyuanEnterpriseExtensionHostOptions,
): Promise<ZhiyuanEnterpriseExtensionSnapshot> {
  return defaultEnterpriseExtensionHost.initialize(options);
}

export function disposeZhiyuanEnterpriseExtension(): Promise<void> {
  return defaultEnterpriseExtensionHost.dispose();
}
