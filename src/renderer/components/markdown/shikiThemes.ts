import type { ThemeInput } from 'streamdown';
import { createCssVariablesTheme } from 'shiki/core';

/**
 * 主题化 shiki 配色：token 色来自主题 token（`syntax-shiki-*`，见
 * tokens/contract.ts），浅色/深色由 CSS 变量随主题原位切换，无需重建高亮器。
 */
const zhiyuanTheme = createCssVariablesTheme({
  name: 'zhiyuan',
  variablePrefix: '--zy-syntax-shiki-',
});

export const zhiyuanShikiThemes: [ThemeInput, ThemeInput] = [zhiyuanTheme, zhiyuanTheme];
