import {
  COMPONENT_SELECTORS,
  COMPONENT_STATES,
  EXTERNAL_COMPONENTS,
  validateComponentAppearances,
} from './contract';
import type { AppearanceStyle, ComponentAppearances, ComponentState } from './contract';

function scopedSelector(scope: string, hook: string, suffix = '', external = false): string {
  // Pseudo-elements must remain outside :where(), after the element's state.
  const pseudo = hook.match(/::(?:before|after)$/)?.[0] ?? '';
  const element = pseudo ? hook.slice(0, -pseudo.length) : hook;
  return `${scope} ${external ? element : `:where(${element})`}${suffix}${pseudo}`;
}

/** Fixed selectors also reach portaled controls under the document theme root. */
export function generateComponentCSS(components: ComponentAppearances, scope: string): string {
  validateComponentAppearances(components);
  const rules: string[] = [];
  const externalRules: string[] = [];
  // Scope-derived names isolate static/default and live theme stylesheets.
  let hash = 2166136261;
  for (const char of scope) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const motionName = (name: string) => `zy-component-${name}-${(hash >>> 0).toString(36)}`;
  const declarations = (style: AppearanceStyle, name: string) =>
    Object.entries(style)
      .map(
        ([key, value]) =>
          `  ${key}: ${key === 'animation-name' && value === 'component-motion' ? motionName(name) : value};`,
      )
      .join('\n');
  // State-first order makes a variant's base unable to override focus/disabled.
  for (const state of Object.keys(COMPONENT_STATES) as ComponentState[]) {
    if (state === 'motionStart' || state === 'motionEnd') continue;
    for (const name of Object.keys(COMPONENT_SELECTORS) as (keyof ComponentAppearances)[]) {
      const style = components[name][state];
      if (!Object.keys(style).length) continue;
      const suffix = ['base', 'wide', 'fileButton', 'placeholder'].includes(state)
        ? COMPONENT_STATES[state]
        : `:where(${COMPONENT_STATES[state]})`;
      const rule = `${scopedSelector(scope, COMPONENT_SELECTORS[name], suffix, EXTERNAL_COMPONENTS.has(name))} {\n${declarations(style, name)}\n}`;
      (EXTERNAL_COMPONENTS.has(name) ? externalRules : rules).push(
        state === 'hover'
          ? `@media (hover: hover) {\n${rule}\n}`
          : state === 'wide'
            ? `@media (min-width: 48rem) {\n${rule}\n}`
            : rule,
      );
    }
  }
  for (const name of Object.keys(COMPONENT_SELECTORS) as (keyof ComponentAppearances)[]) {
    const { motionStart, motionEnd } = components[name];
    if (!Object.keys(motionStart).length && !Object.keys(motionEnd).length) continue;
    rules.push(
      `@keyframes ${motionName(name)} {\nfrom {\n${declarations(motionStart, name)}\n}\nto {\n${declarations(motionEnd, name)}\n}\n}`,
    );
  }
  const controls = Object.values(COMPONENT_SELECTORS)
    .map(selector => scopedSelector(scope, selector))
    .join(',\n');
  rules.push(
    `@media (prefers-reduced-motion: reduce) {\n${controls} { transition-duration: 0s; animation: none; }\n}`,
  );
  const externalControls = [...EXTERNAL_COMPONENTS]
    .map(name =>
      scopedSelector(scope, COMPONENT_SELECTORS[name as keyof ComponentAppearances], '', true),
    )
    .join(',\n');
  externalRules.push(
    `@media (prefers-reduced-motion: reduce) {\n${externalControls} { transition-duration: 0s; animation: none; }\n}`,
  );
  return `@layer components {\n${rules.join('\n')}\n}\n${externalRules.join('\n')}`;
}
