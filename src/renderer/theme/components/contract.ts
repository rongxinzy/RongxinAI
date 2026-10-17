/** Component contract public surface; the implementation lives in ./contract/. */
export { COMPONENT_SELECTORS } from './contract/component-selectors';
export { COMPONENT_STATES } from './contract/component-states';
export type { ComponentState } from './contract/component-states';
export type { AppearanceStyle } from './contract/appearance-properties';
export type { ComponentAppearance, ComponentAppearances } from './contract/types';
export { validateComponentAppearances } from './contract/validate-component-appearances';
export { EXTERNAL_COMPONENTS } from './contract/external-components';
