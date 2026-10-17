const enabled =
  ':not(:disabled):not([aria-disabled="true"]):not([data-disabled=""]):not([data-disabled="true"])';
/** Ordered by precedence: invalid and disabled win over hover and focus. */
export const COMPONENT_STATES = {
  base: '',
  motionStart: '',
  motionEnd: '',
  wide: '',
  fileButton: '::file-selector-button',
  hover: `${enabled}:hover`,
  pressed: `${enabled}:active:not([aria-haspopup])`,
  selected:
    ':is([aria-selected="true"], [aria-pressed="true"], [data-selected=""], [data-selected="true"], [data-active=""], [data-active="true"], [data-state="selected"])',
  checked: ':is([aria-checked="true"], [data-checked])',
  expanded: ':is([aria-expanded="true"], [data-open], [data-popup-open], [data-state="open"])',
  focused: `${enabled}:focus`,
  focusHover: `${enabled}:focus:hover`,
  parentHover: ':is(.group:hover *)',
  parentFocus: ':is(.group:focus-within *)',
  focus: `${enabled}:focus-visible`,
  invalid: ':is([aria-invalid="true"], [data-invalid])',
  disabled: ':is(:disabled, [aria-disabled="true"], [data-disabled=""], [data-disabled="true"])',
  placeholder: '::placeholder',
  entering: '[data-starting-style]',
  exiting: '[data-ending-style]',
  empty: '[data-placeholder]',
  composerFocus: ':has(:is([data-slot="input-group-control"], [contenteditable]):focus-visible)',
  groupFocus: ':has([data-slot="input-group-control"]:focus-visible)',
  groupInvalid: ':has([data-slot][aria-invalid="true"])',
  groupDisabled: ':has([data-slot="input-group-control"]:disabled)',
  highlighted: `${enabled}:is([data-highlighted], [data-selected="true"])`,
} as const;

export type ComponentState = keyof typeof COMPONENT_STATES;
