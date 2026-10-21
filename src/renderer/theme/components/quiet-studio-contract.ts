/**
 * Stable hooks for the v4.0 Quiet Studio shell. Selectors describe composition
 * roles only; every value still comes from the registered theme package.
 */
export const QUIET_STUDIO_SELECTORS = {
  'shell-main-panel': '.theme-main-panel',
  'shell-brand': '.theme-shell-brand',
  'shell-brand-mark': '.theme-shell-brand-mark',
  'shell-kbd': '.theme-shell-kbd',
  'shell-sidebar-time': '.theme-sidebar-time',
  'shell-account-avatar': '.theme-shell-account-avatar',
  'shell-account-name': '.theme-shell-account-name',
  'shell-account-hint': '.theme-shell-account-hint',
  'shell-status-dot': '.theme-shell-status-dot',
  'shell-status-dot-warning': '.theme-shell-status-dot-warning',
  'home-greeting': '.theme-home-greeting',
} as const;
