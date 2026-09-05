/**
 * Shared token defaults — values identical across most themes.
 *
 * Individual themes spread these and override only what differs.
 */
import type { ThemeTokens } from '../themes/types';

export const SHARED_TOKENS: Pick<
  ThemeTokens,
  | 'switch-thumb-foreground'
  | 'destructive'
  | 'destructive-foreground'
  | 'success'
  | 'warning'
  | 'radius'
> = {
  'switch-thumb-foreground': 'oklch(0.366 0.008 253)',
  destructive: 'oklch(0.577 0.245 27.325)',
  'destructive-foreground': 'oklch(0.985 0.001 106.423)',
  success: '#22c55e',
  warning: '#f59e0b',
  radius: '0.625rem',
};
