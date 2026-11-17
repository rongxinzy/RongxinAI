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
