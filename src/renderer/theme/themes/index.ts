import { classicComponentAppearances } from '../components/classic';
import { defineThemePlugins, themePlugins } from './plugins';
import { quietStudioAppearances } from './quiet-studio-v4';
import type { ThemeDefinition } from './types';
import { zenithLight as zenithLightAppearance } from './zenith-light';

const components = { ...classicComponentAppearances(), ...quietStudioAppearances() };

export const allThemes: ThemeDefinition[] = defineThemePlugins(themePlugins).flatMap(plugin => [
  { ...plugin.appearances.light, components },
  { ...plugin.appearances.dark, components },
]);

export const zenithLight = allThemes.find(
  theme => theme.meta.id === zenithLightAppearance.meta.id,
)!;
