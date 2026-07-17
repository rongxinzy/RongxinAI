import { classicDark } from './classic-dark';
import { classicLight } from './classic-light';
import type { ThemeDefinition } from './types';

/** Built-in themes: light + dark. First entry is the default. */
export const allThemes: ThemeDefinition[] = [classicLight, classicDark];

/** Quick lookup by theme ID */
export const themeMap = new Map(allThemes.map(t => [t.meta.id, t]));
