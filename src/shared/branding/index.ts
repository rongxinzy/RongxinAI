import { zhiyuanBranding } from './defaultBranding';
import { xiaoruanBranding } from './editions/xiaoruan';
import type { ProductBrandingConfig } from './types';

const registeredEditions: Record<string, ProductBrandingConfig> = {
  zhiyuan: zhiyuanBranding,
  xiaoruan: xiaoruanBranding,
};

function resolveCurrentEditionId(): string {
  // Check build-time or runtime environment in Node / Electron main process
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.APP_EDITION) {
      return process.env.APP_EDITION.toLowerCase().trim();
    }
    if (process.env.VITE_APP_EDITION) {
      return process.env.VITE_APP_EDITION.toLowerCase().trim();
    }
  }

  // Check window global injection in Renderer process
  if (typeof window !== 'undefined') {
    const injected = (window as unknown as { __APP_EDITION__?: string }).__APP_EDITION__;
    if (injected) {
      return injected.toLowerCase().trim();
    }
  }

  // Check Electron runtime app name if available (avoiding test environments)
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test' && !process.env?.VITEST) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron');
      const app = electron?.app || electron?.remote?.app;
      if (app && typeof app.getName === 'function') {
        const name = app.getName();
        if (name && (name.includes('晓软') || name.toLowerCase().includes('xiaoruan'))) {
          return 'xiaoruan';
        }
      }
    } catch {
      // Not running inside Electron main process
    }
  }
  return 'zhiyuan';
}

export function getBranding(editionId?: string): ProductBrandingConfig {
  const id = editionId || resolveCurrentEditionId();
  return registeredEditions[id] || zhiyuanBranding;
}

export type { ProductBrandingConfig } from './types';
