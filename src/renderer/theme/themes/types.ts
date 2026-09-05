import type { ThemeBackground } from '../background/background';
import type { TokenName } from '../tokens/contract';

export interface ThemeMeta {
  id: string;
  name: string;
  description: string;
  appearance: 'light' | 'dark';
}

/** A theme must provide a CSS value for every key in TOKEN_CONTRACT */
export type ThemeTokens = Record<TokenName, string>;

export interface ThemeDefinition {
  meta: ThemeMeta;
  tokens: ThemeTokens;
  background?: ThemeBackground;
}
