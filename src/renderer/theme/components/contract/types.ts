import type { COMPONENT_SELECTORS } from './component-selectors';
import type { AppearanceStyle } from './appearance-properties';
import type { ComponentState } from './component-states';

/** Empty states explicitly inherit the base appearance (e.g. pressed text fields). */
export type ComponentAppearance = Record<ComponentState, AppearanceStyle>;
export type ComponentAppearances = Record<keyof typeof COMPONENT_SELECTORS, ComponentAppearance>;
