import { configs } from './context.mjs';
import { esc } from './html.mjs';
import { caseSkin, commonCss } from './styles.mjs';

export function pageShell(c, body, css = '', script = '') {
  const cfg = configs[c.skill];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(c.lead)}"><title>${esc(c.title)} · ${esc(c.label)}</title><style>:root{--accent:${cfg.accent}}${commonCss}${css}${caseSkin(c)}</style></head><body data-case="${esc(c.id)}">${body}<script>${script}</script></body></html>`;
}
