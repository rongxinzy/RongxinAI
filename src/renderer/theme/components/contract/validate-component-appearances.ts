import { TOKEN_CONTRACT } from '../../tokens/contract';
import { COMPONENT_SELECTORS } from './component-selectors';
import { COMPONENT_STATES } from './component-states';
import type { ComponentState } from './component-states';
import { APPEARANCE_PROPERTIES } from './appearance-properties';
import type { ComponentAppearances } from './types';

const appearanceVariables = new Set<string>([
  ...Object.values(TOKEN_CONTRACT),
  '--zy-control-icon-size',
]);

export function validateComponentAppearances(components: ComponentAppearances): void {
  if (!components || typeof components !== 'object')
    throw new Error('Missing component appearances');
  for (const name of Object.keys(components)) {
    if (!Object.hasOwn(COMPONENT_SELECTORS, name))
      throw new Error(`Unknown component appearance: ${name}`);
  }
  for (const name of Object.keys(COMPONENT_SELECTORS) as (keyof ComponentAppearances)[]) {
    const recipe = components[name];
    if (!recipe || typeof recipe !== 'object')
      throw new Error(`Missing component appearance: ${name}`);
    for (const state of Object.keys(recipe)) {
      if (!Object.hasOwn(COMPONENT_STATES, state))
        throw new Error(`Unknown component state: ${state}`);
    }
    for (const state of Object.keys(COMPONENT_STATES) as ComponentState[]) {
      const declarations = recipe[state];
      if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations)) {
        throw new Error(`Missing component state: ${name}.${state}`);
      }
      for (const [property, value] of Object.entries(declarations)) {
        if (
          (state === 'motionStart' || state === 'motionEnd') &&
          !['opacity', 'scale', 'translate', 'rotate'].includes(property)
        ) {
          throw new Error(`Invalid component motion property: ${property}`);
        }
        if (!APPEARANCE_PROPERTIES.includes(property as never))
          throw new Error(`Invalid appearance property: ${property}`);
        if (
          typeof value !== 'string' ||
          !value.trim() ||
          /[;{}<>\\]|url\s*\(|@|!important|expression\s*\(/i.test(value)
        ) {
          throw new Error(`Invalid appearance value: ${name}.${state}.${property}`);
        }
        if (property === 'animation-name' && value !== 'none' && value !== 'component-motion') {
          throw new Error(`Unknown component animation: ${value}`);
        }
        if (
          property === 'animation-name' &&
          value === 'component-motion' &&
          (!recipe.motionStart ||
            !Object.keys(recipe.motionStart).length ||
            !recipe.motionEnd ||
            !Object.keys(recipe.motionEnd).length)
        ) {
          throw new Error(`Missing component motion frames: ${name}`);
        }
        for (const match of value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
          if (!appearanceVariables.has(match[1]))
            throw new Error(`Unknown appearance variable: ${match[1]}`);
        }
      }
    }
  }
}
