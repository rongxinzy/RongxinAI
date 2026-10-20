import { BackgroundKind } from '../background/background';
import { zenithLight } from './zenith-light';
import { zenithDark } from './zenith-dark';
import { validateComponentAppearances } from '../components/contract';
import type { ThemeDefinition } from './types';
import { TOKEN_NAMES } from '../tokens/contract';
import { quietStudioV4DarkOverrides, quietStudioV4LightOverrides } from './quiet-studio-v4';

export const THEME_PLUGIN_VERSION = 1 as const;
export const DEFAULT_THEME_PLUGIN_ID = 'zenith';

/** Presentation data only. Plugins cannot replace controls or own application state. */
export interface ThemePlugin {
  version: typeof THEME_PLUGIN_VERSION;
  id: string;
  name: { zh: string; en: string };
  appearances: { light: ThemeDefinition; dark: ThemeDefinition };
}

export function validateTheme(theme: ThemeDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(theme.meta.id)) throw new Error('Invalid theme ID');
  if (!['light', 'dark'].includes(theme.meta.appearance)) throw new Error('Invalid appearance');
  for (const token of TOKEN_NAMES) {
    const value = theme.tokens[token];
    if (typeof value !== 'string' || !value.trim() || /[;{}<>]|url\s*\(|@import/i.test(value)) {
      throw new Error(`Invalid theme token: ${token}`);
    }
  }
  validateComponentAppearances(theme.components);
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

function withQuietStudio(
  theme: ThemeDefinition,
  overrides: Partial<ThemeDefinition['tokens']>,
): ThemeDefinition {
  return {
    ...theme,
    background: {
      kind: BackgroundKind.None,
      color: theme.background?.color ?? '#F4F5F7',
      opacity: 0,
      texture: theme.background?.texture ?? 'paper',
      fit: theme.background?.fit ?? 'cover',
    },
    tokens: { ...theme.tokens, ...overrides },
  };
}

/**
 * One theme pair. Quiet Studio v4 replaces the Zenith glass, glow, and
 * enlarged type scale; the plugin id stays `zenith` so saved appearance
 * preferences keep resolving.
 */
export const themePlugins = defineThemePlugins([
  {
    version: THEME_PLUGIN_VERSION,
    id: DEFAULT_THEME_PLUGIN_ID,
    name: { zh: 'Zenith', en: 'Zenith' },
    appearances: {
      light: withQuietStudio(zenithLight, quietStudioV4LightOverrides),
      dark: withQuietStudio(zenithDark, quietStudioV4DarkOverrides),
    },
  },
]);

export function resolveThemePlugin(id: string): ThemePlugin {
  return themePlugins.find(plugin => plugin.id === id) ?? themePlugins[0];
}
