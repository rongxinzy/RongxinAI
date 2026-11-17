import type { OrbState } from 'thinking-orbs';

// This chooses only the library's sphere geometry, not a product search state.
export const THINKING_ORB_STATE = 'searching' satisfies OrbState;

export const ThinkingIndicatorVariant = {
  Inline: 'inline',
  Companion: 'companion',
} as const;

export type ThinkingIndicatorVariant =
  (typeof ThinkingIndicatorVariant)[keyof typeof ThinkingIndicatorVariant];

// These select the library's particle-density presets. The visible dimensions
// belong to the registered theme recipes on the host element.
export const THINKING_ORB_PRESETS = {
  [ThinkingIndicatorVariant.Inline]: 20,
  [ThinkingIndicatorVariant.Companion]: 32,
} as const;
