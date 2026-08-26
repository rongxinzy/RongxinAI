import fs from 'node:fs';
import path from 'node:path';

import {
  ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION,
  ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION,
  type ZhiyuanEnterpriseRendererHostCapability,
  type ZhiyuanEnterpriseSettingsHostCapability,
  type ZhiyuanEnterpriseSettingsPageRegistration,
} from './contract';
import type { EnterpriseRendererSettingsPage } from '../../shared/enterpriseRenderer';

export const ZHIYUAN_ENTERPRISE_RENDERER_SCHEME = 'zhiyuan-enterprise-ui';
export const ZHIYUAN_ENTERPRISE_RENDERER_ORIGIN = `${ZHIYUAN_ENTERPRISE_RENDERER_SCHEME}://renderer`;

const MAX_ENTRYPOINT_LENGTH = 512;
const MAX_LABEL_LENGTH = 64;
const SETTINGS_RESOURCE_PREFIX = 'settings/';
const SETTINGS_PAGE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

interface RegisteredRendererPage {
  readonly rootDirectory: string;
  readonly entrypoint: string;
}

interface RegisteredSettingsPage extends RegisteredRendererPage {
  readonly id: string;
  readonly labels: EnterpriseRendererSettingsPage['labels'];
}

export class ZhiyuanEnterpriseRendererBridge {
  #sessionGate: RegisteredRendererPage | null = null;
  readonly #settingsPages = new Map<string, RegisteredSettingsPage>();

  createScopedCapability(extensionDirectory: string): ZhiyuanEnterpriseRendererHostCapability {
    const rootDirectory = realDirectory(extensionDirectory);
    return Object.freeze({
      apiVersion: ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION,
      registerSessionGate: (entrypoint: string) =>
        this.#registerSessionGate(rootDirectory, entrypoint),
    });
  }

  createScopedSettingsCapability(
    extensionDirectory: string,
  ): ZhiyuanEnterpriseSettingsHostCapability {
    const rootDirectory = realDirectory(extensionDirectory);
    return Object.freeze({
      apiVersion: ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION,
      registerPage: (page: ZhiyuanEnterpriseSettingsPageRegistration) =>
        this.#registerSettingsPage(rootDirectory, page),
    });
  }

  sessionGateEntrypoint(): string | null {
    const registration = this.#sessionGate;
    return registration
      ? `${ZHIYUAN_ENTERPRISE_RENDERER_ORIGIN}/${encodeURIComponent(registration.entrypoint)}`
      : null;
  }

  settingsPages(): readonly EnterpriseRendererSettingsPage[] {
    return Object.freeze(
      [...this.#settingsPages.values()].map(registration =>
        Object.freeze({
          id: registration.id,
          entrypoint: `${ZHIYUAN_ENTERPRISE_RENDERER_ORIGIN}/${SETTINGS_RESOURCE_PREFIX}${encodeURIComponent(registration.id)}/${encodeURIComponent(registration.entrypoint)}`,
          labels: registration.labels,
        }),
      ),
    );
  }

  resolveAsset(requestUrl: string): string | null {
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      return null;
    }
    if (url.protocol !== `${ZHIYUAN_ENTERPRISE_RENDERER_SCHEME}:` || url.host !== 'renderer') {
      return null;
    }

    let relativePath: string;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
    if (relativePath.startsWith(SETTINGS_RESOURCE_PREFIX)) {
      const settingsPath = relativePath.slice(SETTINGS_RESOURCE_PREFIX.length);
      const separator = settingsPath.indexOf('/');
      if (separator <= 0) return null;
      const registration = this.#settingsPages.get(settingsPath.slice(0, separator));
      return registration
        ? resolveRegularFile(registration.rootDirectory, settingsPath.slice(separator + 1))
        : null;
    }
    return this.#sessionGate
      ? resolveRegularFile(this.#sessionGate.rootDirectory, relativePath)
      : null;
  }

  #registerSessionGate(rootDirectory: string, entrypoint: string): () => void {
    if (this.#sessionGate) {
      throw new Error('A Zhiyuan enterprise session gate is already registered.');
    }
    const normalizedEntrypoint = normalizeRelativePath(entrypoint);
    const resolvedEntrypoint = resolveRegularFile(rootDirectory, normalizedEntrypoint);
    if (!resolvedEntrypoint) {
      throw new Error('Zhiyuan enterprise session gate entrypoint is not a regular file.');
    }

    const registration = Object.freeze({
      rootDirectory: path.dirname(resolvedEntrypoint),
      entrypoint: path.basename(resolvedEntrypoint),
    });
    this.#sessionGate = registration;
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.#sessionGate === registration) this.#sessionGate = null;
    };
  }

  #registerSettingsPage(
    rootDirectory: string,
    page: ZhiyuanEnterpriseSettingsPageRegistration,
  ): () => void {
    if (!page || typeof page !== 'object') {
      throw new Error('Zhiyuan enterprise settings page registration is invalid.');
    }
    if (!SETTINGS_PAGE_ID_PATTERN.test(page.id)) {
      throw new Error('Zhiyuan enterprise settings page ID is invalid.');
    }
    if (this.#settingsPages.has(page.id)) {
      throw new Error(`Zhiyuan enterprise settings page ${page.id} is already registered.`);
    }
    const normalizedEntrypoint = normalizeRelativePath(page.entrypoint);
    const resolvedEntrypoint = resolveRegularFile(rootDirectory, normalizedEntrypoint);
    if (!resolvedEntrypoint) {
      throw new Error('Zhiyuan enterprise settings page entrypoint is not a regular file.');
    }
    const labels = Object.freeze({
      zh: normalizeLabel(page.labels?.zh),
      en: normalizeLabel(page.labels?.en),
    });
    const registration = Object.freeze({
      id: page.id,
      rootDirectory: path.dirname(resolvedEntrypoint),
      entrypoint: path.basename(resolvedEntrypoint),
      labels,
    });
    this.#settingsPages.set(page.id, registration);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.#settingsPages.get(page.id) === registration) this.#settingsPages.delete(page.id);
    };
  }
}

export const zhiyuanEnterpriseRendererBridge = new ZhiyuanEnterpriseRendererBridge();

function normalizeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENTRYPOINT_LENGTH) {
    throw new Error('Zhiyuan enterprise renderer entrypoint is invalid.');
  }
  const normalized = value.replaceAll('\\', '/');
  if (
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(normalized) ||
    normalized.includes('\0') ||
    normalized.split('/').some(segment => segment === '..' || segment.length === 0)
  ) {
    throw new Error('Zhiyuan enterprise renderer entrypoint must be a safe relative path.');
  }
  return normalized;
}

function normalizeLabel(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_LABEL_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)
  ) {
    throw new Error('Zhiyuan enterprise settings page label is invalid.');
  }
  return value;
}

function resolveRegularFile(rootDirectory: string, relativePath: string): string | null {
  let normalizedPath: string;
  try {
    normalizedPath = normalizeRelativePath(relativePath);
  } catch {
    return null;
  }
  const candidate = path.resolve(rootDirectory, ...normalizedPath.split('/'));
  try {
    const realCandidate = fs.realpathSync(candidate);
    if (!isWithin(rootDirectory, realCandidate) || !fs.statSync(realCandidate).isFile())
      return null;
    return realCandidate;
  } catch {
    return null;
  }
}

function realDirectory(directory: string): string {
  const realPath = fs.realpathSync(directory);
  if (!fs.statSync(realPath).isDirectory()) {
    throw new Error('Zhiyuan enterprise extension directory is invalid.');
  }
  return realPath;
}

function isWithin(rootDirectory: string, candidate: string): boolean {
  const relative = path.relative(rootDirectory, candidate);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..';
}
