import { themePlugins } from './plugins';
import type { ThemeDefinition } from './types';

export const allThemes: ThemeDefinition[] = themePlugins.flatMap(plugin => [
  plugin.appearances.light,
  plugin.appearances.dark,
]);
