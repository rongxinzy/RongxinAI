import fs from 'node:fs';
import path from 'node:path';

import {
  ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION,
  type ZhiyuanEnterpriseRendererHostCapability,
} from './contract';

export const ZHIYUAN_ENTERPRISE_RENDERER_SCHEME = 'zhiyuan-enterprise-ui';
export const ZHIYUAN_ENTERPRISE_RENDERER_ORIGIN = `${ZHIYUAN_ENTERPRISE_RENDERER_SCHEME}://renderer`;

const MAX_ENTRYPOINT_LENGTH = 512;

interface RegisteredSessionGate {
  readonly rootDirectory: string;
  readonly entrypoint: string;
}

export class ZhiyuanEnterpriseRendererBridge {
  #sessionGate: RegisteredSessionGate | null = null;

  createScopedCapability(extensionDirectory: string): ZhiyuanEnterpriseRendererHostCapability {
    const rootDirectory = realDirectory(extensionDirectory);
    return Object.freeze({
      apiVersion: ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION,
      registerSessionGate: (entrypoint: string) =>
        this.#registerSessionGate(rootDirectory, entrypoint),
    });
  }

  sessionGateEntrypoint(): string | null {
    const registration = this.#sessionGate;
    return registration
      ? `${ZHIYUAN_ENTERPRISE_RENDERER_ORIGIN}/${encodeURI(registration.entrypoint)}`
      : null;
  }

  resolveAsset(requestUrl: string): string | null {
    const registration = this.#sessionGate;
    if (!registration) return null;

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
    return resolveRegularFile(registration.rootDirectory, relativePath);
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
}

export const zhiyuanEnterpriseRendererBridge = new ZhiyuanEnterpriseRendererBridge();

function normalizeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENTRYPOINT_LENGTH) {
    throw new Error('Zhiyuan enterprise session gate entrypoint is invalid.');
  }
  const normalized = value.replaceAll('\\', '/');
  if (
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(normalized) ||
    normalized.includes('\0') ||
    normalized.split('/').some(segment => segment === '..' || segment.length === 0)
  ) {
    throw new Error('Zhiyuan enterprise session gate entrypoint must be a safe relative path.');
  }
  return normalized;
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
