import { expect, test } from 'vitest';
import { allThemes } from '../themes';
import { generateComponentCSS } from './css';

test('compact tool status overrides primitive badge styling in every theme', () => {
  for (const theme of allThemes) {
    const css = generateComponentCSS(theme.components, '[data-theme="test"]');
    const status = css.indexOf(':where(.theme-chat-tool-status) {');
    expect(status).toBeGreaterThan(css.indexOf(':where(.theme-badge-secondary) {'));
    expect(css.slice(status, css.indexOf('}', status))).toContain('background-color: transparent');
    expect(
      css.indexOf(':where(.theme-chat-tool-status[data-tool-state="output-error"]) {'),
    ).toBeGreaterThan(status);
  }
});
