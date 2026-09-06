import { classicScenes } from './classic-scenes';
import { classicSidebar } from './classic-sidebar';
import { classicFields } from './classic-fields';
import { classicMisc } from './classic-misc';
import { classicDisplay } from './classic-display';
import { classicChoiceControls } from './classic-choice-controls';
import { classicSupplementaryControls } from './classic-supplementary-controls';
import { classicTabs } from './classic-tabs';
import { classicMessageSurfaces } from './classic-message-surfaces';
import { classicPromptActions } from './classic-prompt-actions';
import { classicControlPieces } from './classic-control-pieces';
import { classicControlSizing } from './classic-control-sizing';
import { classicEditorControls } from './classic-editor-controls';
import { classicInteractiveSurfaces } from './classic-interactive-surfaces';
import { classicNativeControls } from './classic-native-controls';
import { classicModalEffects } from './classic-modal-effects';
import { classicSharedCompositions } from './classic-shared-compositions';
import { classicLocalControls } from './classic-local-controls';
import { classicCompositionControls } from './classic-composition-controls';
import { classicPartControls } from './classic-part-controls';
import { classicConditionalControls } from './classic-conditional-controls';
import { classicPageControls } from './classic-page-controls';
import { classicControlModifiers } from './classic-control-modifiers';
import { classicSettingsControls } from './classic-settings-controls';
import { classicProductControls } from './classic-product-controls';
import { classicExtraOverlays } from './classic-extra-overlays';
import { classicMenu } from './classic-menu';
import { classicCommand } from './classic-command';
import { recipe } from './recipe';
import { classicSurfaces } from './classic-surfaces';
import { classicBadges } from './classic-badges';
import { classicSelect } from './classic-select';
import { classicButtons } from './classic-buttons';
import type { ComponentAppearance, ComponentAppearances } from './contract';

/** Codex appearance recipes are package data, never imported by React controls. */
export function classicComponentAppearances(dark: boolean): ComponentAppearances {
  const field: ComponentAppearance = recipe({
    base: {
      'border-radius': 'var(--zy-style-radius-lg)',
      'border-width': '1px',
      'border-style': 'solid',
      'border-color': 'var(--input)',
      'background-color': dark
        ? 'color-mix(in oklab, var(--input) 30%, transparent)'
        : 'var(--zy-surface)',
      'outline-style': 'none',
      'transition-property': 'color, background-color, border-color, box-shadow',
      'transition-duration': '150ms',
      'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
    hover: { 'border-color': 'color-mix(in oklab, var(--ring) 50%, transparent)' },
    pressed: {},
    selected: {},
    expanded: {},
    focus: {
      'border-color': 'var(--ring)',
      'box-shadow': '0 0 0 1px color-mix(in oklab, var(--ring) 40%, transparent)',
    },
    invalid: {
      'border-color': dark
        ? 'color-mix(in oklab, var(--destructive) 50%, transparent)'
        : 'var(--destructive)',
      'box-shadow': '0 0 0 1px color-mix(in oklab, var(--destructive) 40%, transparent)',
    },
    disabled: {
      opacity: '0.5',
      'background-color': `color-mix(in oklab, var(--input) ${dark ? 80 : 50}%, transparent)`,
    },
    placeholder: { color: 'var(--muted-foreground)' },
    highlighted: {},
    entering: {},
    exiting: {},
    empty: {},
  });
  return {
    ...classicButtons(dark),
    ...classicSurfaces(),
    ...classicCommand(),
    ...classicMenu(dark),
    ...classicExtraOverlays(),
    ...classicProductControls(),
    ...classicSettingsControls(),
    ...classicControlModifiers(),
    ...classicPartControls(dark),
    ...classicCompositionControls(),
    ...classicPageControls(dark),
    ...classicConditionalControls(dark),
    ...classicBadges(dark),
    ...classicSelect(dark),
    'input-group': recipe({
      base: {
        ...field.base,
        'background-color': dark
          ? 'color-mix(in oklab, var(--input) 30%, transparent)'
          : 'transparent',
        height: '2rem',
      },
      hover: field.hover,
      groupFocus: field.focus,
      groupInvalid: field.invalid,
      groupDisabled: { ...field.disabled, 'border-color': 'var(--input)' },
    }),
    'input-embedded': recipe({
      base: {
        'border-radius': '0px',
        'border-width': '0px',
        'background-color': 'transparent',
        'box-shadow': 'none',
      },
      hover: { 'box-shadow': 'none' },
      focus: { 'border-width': '0px', 'box-shadow': 'none' },
      invalid: { 'box-shadow': 'none' },
      disabled: { 'background-color': 'transparent' },
    }),
    'input-group-addon': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--muted-foreground)',
      },
    }),
    'input-group-text': recipe({
      base: { 'font-size': 'var(--zy-component-text-sm)', color: 'var(--muted-foreground)' },
    }),
    input: recipe({
      ...structuredClone(field),
      base: {
        ...field.base,
        height: '2rem',
        'padding-inline': '0.625rem',
        'padding-block': '0.25rem',
        'font-size': 'var(--zy-component-text-base)',
        'line-height': 'var(--zy-component-text-base--line-height)',
      },
      wide: { 'font-size': 'var(--zy-component-text-sm)' },
      fileButton: {
        height: '1.5rem',
        'border-width': '0px',
        'background-color': 'transparent',
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
      },
    }),
    textarea: recipe({
      ...structuredClone(field),
      base: {
        ...field.base,
        'min-height': '4rem',
        'padding-inline': '0.625rem',
        'padding-block': '0.5rem',
        'font-size': 'var(--zy-component-text-base)',
        'line-height': 'var(--zy-component-text-base--line-height)',
      },
      wide: { 'font-size': 'var(--zy-component-text-sm)' },
    }),
    ...classicSharedCompositions(),
    ...classicLocalControls(),
    ...classicModalEffects(dark),
    ...classicNativeControls(dark),
    ...classicInteractiveSurfaces(dark),
    ...classicEditorControls(),
    ...classicControlSizing(),
    ...classicControlPieces(),
    ...classicPromptActions(),
    ...classicMessageSurfaces(dark),
    ...classicTabs(dark),
    ...classicSupplementaryControls(dark),
    ...classicChoiceControls(dark),
    ...classicDisplay(),
    ...classicMisc(dark),
    ...classicFields(dark),
    ...classicSidebar(),
    ...classicScenes(),
  };
}
