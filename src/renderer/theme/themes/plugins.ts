import { zenithLight } from './zenith-light';
import { zenithDark } from './zenith-dark';
import type { ThemeAppearance } from './types';
import { TOKEN_NAMES } from '../tokens/contract';

const THEME_PLUGIN_VERSION = 1 as const;

/** Presentation data only. Plugins cannot replace controls or own application state. */
export interface ThemePlugin {
  version: typeof THEME_PLUGIN_VERSION;
  id: string;
  name: { zh: string; en: string };
  appearances: { light: ThemeAppearance; dark: ThemeAppearance };
}

export function validateTheme(theme: ThemeAppearance): void {
  if (!/^[a-z][a-z0-9-]*$/.test(theme.meta.id)) throw new Error('Invalid theme ID');
  if (!['light', 'dark'].includes(theme.meta.appearance)) throw new Error('Invalid appearance');
  for (const token of TOKEN_NAMES) {
    const value = theme.tokens[token];
    if (typeof value !== 'string' || !value.trim() || /[;{}<>]|url\s*\(|@import/i.test(value)) {
      throw new Error(`Invalid theme token: ${token}`);
    }
  }
  const extra = Object.keys(theme.tokens).find(key => !TOKEN_NAMES.includes(key as never));
  if (extra) throw new Error(`Unknown theme token: ${extra}`);
}

export function defineThemePlugins(plugins: ThemePlugin[]): ThemePlugin[] {
  if (plugins.length === 0) throw new Error('At least one theme plugin is required');
  const ids = new Set<string>();
  const themeIds = new Set<string>();
  for (const plugin of plugins) {
    if (
      plugin.version !== THEME_PLUGIN_VERSION ||
      !/^[a-z][a-z0-9-]*$/.test(plugin.id) ||
      ids.has(plugin.id)
    ) {
      throw new Error(`Invalid or duplicate theme plugin: ${plugin.id}`);
    }
    ids.add(plugin.id);
    for (const appearance of ['light', 'dark'] as const) {
      const theme = plugin.appearances[appearance];
      validateTheme(theme);
      if (theme.meta.appearance !== appearance || themeIds.has(theme.meta.id))
        throw new Error('Invalid theme appearance mapping');
      themeIds.add(theme.meta.id);
    }
  }
  return plugins;
}

/**
 * Zenith - Premium Futuristic Design System
 *
 * Consolidated to a single world-class theme pair for stronger brand identity.
 * Traditional themes (Daming, Changan, Weiyang, Xiaoruan) removed to focus on
 * premium, tech-forward aesthetic.
 */
export const themePlugins: ThemePlugin[] = [
  {
    version: THEME_PLUGIN_VERSION,
    id: 'zenith',
    name: { zh: 'Zenith', en: 'Zenith' },
    appearances: { light: zenithLight, dark: zenithDark },
  },
];
