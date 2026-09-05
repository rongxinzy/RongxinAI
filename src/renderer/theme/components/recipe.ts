import { COMPONENT_STATES } from './contract';
import type { AppearanceStyle, ComponentAppearance } from './contract';

/** Omitted states inherit the base; typography retains its paired theme line-height. */
export function recipe(overrides: Partial<ComponentAppearance>): ComponentAppearance {
  return Object.fromEntries(
    Object.keys(COMPONENT_STATES).map(state => {
      const style: AppearanceStyle = { ...overrides[state as keyof ComponentAppearance] };
      const font = style['font-size'];
      if (!style['line-height'] && font?.match(/^var\(--zy-component-text-[a-z0-9]+\)$/)) {
        style['line-height'] = font.replace(')', '--line-height)');
      }
      return [state, style];
    }),
  ) as ComponentAppearance;
}
