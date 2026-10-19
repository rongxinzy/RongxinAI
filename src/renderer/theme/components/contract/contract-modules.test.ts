import { expect, test } from 'vitest';
import { zenithLight } from '../../themes/zenith-light';
import { COMPONENT_SELECTORS, EXTERNAL_COMPONENTS } from '../contract';
import { APP_SELECTORS } from './selectors-app';
import { COMPONENT_STATES } from './component-states';
import { CORE_SELECTORS } from './selectors-core';
import { OVERLAY_SELECTORS } from './selectors-overlays';
import { PAGE_HOOK_SELECTORS } from './selectors-page-hooks';
import { validateComponentAppearances } from './validate-component-appearances';

test('selector groups merge without silently overriding any hook', () => {
  const groups = [CORE_SELECTORS, OVERLAY_SELECTORS, PAGE_HOOK_SELECTORS, APP_SELECTORS];
  const merged = Object.keys(COMPONENT_SELECTORS);
  expect(merged).toHaveLength(
    groups.reduce((total, group) => total + Object.keys(group).length, 0),
  );
  expect(new Set(merged).size).toBe(merged.length);
  for (const group of groups) {
    for (const [hook, selector] of Object.entries(group)) {
      expect(COMPONENT_SELECTORS[hook as keyof typeof COMPONENT_SELECTORS]).toBe(selector);
    }
  }
});

test('component states keep guarded precedence and pseudo-element hooks', () => {
  const enabled =
    ':not(:disabled):not([aria-disabled="true"]):not([data-disabled=""]):not([data-disabled="true"])';
  expect(Object.keys(COMPONENT_STATES)).toEqual([
    'base',
    'motionStart',
    'motionEnd',
    'wide',
    'fileButton',
    'hover',
    'pressed',
    'selected',
    'checked',
    'expanded',
    'focused',
    'focusHover',
    'parentHover',
    'parentFocus',
    'focus',
    'invalid',
    'disabled',
    'placeholder',
    'entering',
    'exiting',
    'empty',
    'composerFocus',
    'groupFocus',
    'groupInvalid',
    'groupDisabled',
    'highlighted',
  ]);
  expect(COMPONENT_STATES.hover).toBe(`${enabled}:hover`);
  expect(COMPONENT_STATES.pressed).toBe(`${enabled}:active:not([aria-haspopup])`);
  expect(COMPONENT_STATES.selected).toContain('[data-active="true"]');
  expect(COMPONENT_STATES.placeholder).toBe('::placeholder');
});

test('external components only reference registered fixed integration hooks', () => {
  expect(EXTERNAL_COMPONENTS.has('toast')).toBe(true);
  for (const name of EXTERNAL_COMPONENTS) {
    expect(COMPONENT_SELECTORS[name as keyof typeof COMPONENT_SELECTORS]).toBeDefined();
  }
});

test('validation rejects unknown hooks and states', () => {
  const withUnknownHook = structuredClone(zenithLight.components) as Record<string, unknown>;
  withUnknownHook['not-a-component-hook'] = structuredClone(zenithLight.components.input);
  expect(() =>
    validateComponentAppearances(
      withUnknownHook as Parameters<typeof validateComponentAppearances>[0],
    ),
  ).toThrow('Unknown component appearance');
  const withUnknownState = structuredClone(zenithLight.components);
  Reflect.set(withUnknownState.input, 'not-a-state', {});
  expect(() => validateComponentAppearances(withUnknownState)).toThrow('Unknown component state');
});

test('validation rejects non-object state declarations', () => {
  const components = structuredClone(zenithLight.components);
  Reflect.set(components.input, 'focus', []);
  expect(() => validateComponentAppearances(components)).toThrow('Missing component state');
});
