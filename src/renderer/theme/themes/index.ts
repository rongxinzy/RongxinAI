import { themePlugins } from './plugins';
import type { ThemeDefinition } from './types';

export const allThemes: ThemeDefinition[] = themePlugins.flatMap(plugin => [
  plugin.appearances.light,
  plugin.appearances.dark,
]);
export const themeMap = new Map(allThemes.map(theme => [theme.meta.id, theme]));
