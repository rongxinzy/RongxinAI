/**
 * Token Contract — defines all semantic variables a theme must provide.
 *
 * Naming: --zy-{category}-{name}
 * Convention: shadcn/ui background/foreground pairing + Radix 12-step gray scale
 *
 * Every theme (ThemeDefinition.tokens) must supply a value for each key.
 */
export const TOKEN_CONTRACT = {
  // ── Brand ──
  primary: '--zy-primary',
  'primary-foreground': '--zy-primary-foreground',
  'primary-hover': '--zy-primary-hover',
  'primary-muted': '--zy-primary-muted',
  // Button-grade primary: deep enough for AA white text even in dark themes
  // where `primary` is brightened for text/icon legibility.
  'primary-strong': '--zy-primary-strong',
  'switch-thumb-foreground': '--zy-switch-thumb-foreground',
  'switch-track-checked': '--zy-switch-track-checked',
  'switch-track-checked-hover': '--zy-switch-track-checked-hover',

  // ── Accent ──
  accent: '--zy-accent',
  'accent-foreground': '--zy-accent-foreground',

  // ── Surface / Background ──
  background: '--zy-background',
  foreground: '--zy-foreground',
  surface: '--zy-surface',
  'surface-foreground': '--zy-surface-foreground',
  'surface-raised': '--zy-surface-raised',
  'surface-tertiary': '--zy-surface-tertiary',
  'surface-overlay': '--zy-surface-overlay',

  // ── Chat bubbles ──
  'chat-user': '--zy-chat-user',
  'chat-user-foreground': '--zy-chat-user-foreground',
  'chat-bot': '--zy-chat-bot',
  'chat-bot-foreground': '--zy-chat-bot-foreground',
  'model-tag-neutral-background': '--zy-model-tag-neutral-background',
  'model-tag-neutral-foreground': '--zy-model-tag-neutral-foreground',
  'model-tag-neutral-border': '--zy-model-tag-neutral-border',
  'model-tag-violet-background': '--zy-model-tag-violet-background',
  'model-tag-violet-foreground': '--zy-model-tag-violet-foreground',
  'model-tag-violet-border': '--zy-model-tag-violet-border',
  'model-tag-green-background': '--zy-model-tag-green-background',
  'model-tag-green-foreground': '--zy-model-tag-green-foreground',
  'model-tag-green-border': '--zy-model-tag-green-border',
  'skill-blue-background': '--zy-skill-blue-background',
  'skill-blue-foreground': '--zy-skill-blue-foreground',

  // ── Text hierarchy ──
  'text-primary': '--zy-text-primary',
  'text-muted-foreground': '--zy-text-secondary',
  'text-muted': '--zy-text-muted',

  // ── Borders ──
  border: '--zy-border',
  'border-subtle': '--zy-border-subtle',
  'input-border': '--zy-input-border',

  // ── Scrollbar ──
  'scroll-thumb': '--zy-scroll-thumb',
  'scroll-thumb-hover': '--zy-scroll-thumb-hover',

  // ── Decorative gradients ──
  'gradient-1': '--zy-gradient-1',
  'gradient-2': '--zy-gradient-2',

  // ── Status ──
  destructive: '--zy-destructive',
  'destructive-foreground': '--zy-destructive-foreground',
  success: '--zy-success',
  warning: '--zy-warning',

  // ── Gray scale 11 steps (gray-1=lightest → gray-11=darkest, all themes) ──
  'gray-1': '--zy-gray-1',
  'gray-2': '--zy-gray-2',
  'gray-3': '--zy-gray-3',
  'gray-4': '--zy-gray-4',
  'gray-5': '--zy-gray-5',
  'gray-6': '--zy-gray-6',
  'gray-7': '--zy-gray-7',
  'gray-8': '--zy-gray-8',
  'gray-9': '--zy-gray-9',
  'gray-10': '--zy-gray-10',
  'gray-11': '--zy-gray-11',

  // ── Focus ring ──
  ring: '--zy-ring',

  // ── Radius ──
  radius: '--zy-radius',
} as const;

export type TokenName = keyof typeof TOKEN_CONTRACT;
export type CSSVarName = (typeof TOKEN_CONTRACT)[TokenName];

/** All token keys as an array */
export const TOKEN_NAMES = Object.keys(TOKEN_CONTRACT) as TokenName[];
