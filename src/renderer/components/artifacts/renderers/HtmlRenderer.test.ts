import { describe, expect, test } from 'vitest';

import { ensurePreviewColorScheme, injectPreviewNavigationGuard } from './HtmlRenderer';

describe('ensurePreviewColorScheme', () => {
  test('injects light color-scheme when the document does not declare one', () => {
    const html = '<!DOCTYPE html><html><head><title>简历</title></head><body><h1>关于</h1></body></html>';
    const result = ensurePreviewColorScheme(html);
    expect(result).toContain('name="color-scheme" content="light"');
    expect(result).toContain(':root{color-scheme:light;}');
    expect(result.indexOf('color-scheme')).toBeLessThan(result.indexOf('</head>'));
  });

  test('keeps an explicit color-scheme declaration untouched', () => {
    const html =
      '<html><head><meta name="color-scheme" content="dark"><style>:root{color-scheme:dark}</style></head><body></body></html>';
    expect(ensurePreviewColorScheme(html)).toBe(html);
  });
});

describe('injectPreviewNavigationGuard', () => {
  test('injects a click guard once before </body>', () => {
    const html = '<html><body><a href="about.html">关于</a></body></html>';
    const once = injectPreviewNavigationGuard(html);
    expect(once).toContain('data-xiaoruan-preview-nav-guard');
    expect(once.indexOf('data-xiaoruan-preview-nav-guard')).toBeLessThan(once.indexOf('</body>'));
    expect(injectPreviewNavigationGuard(once)).toBe(once);
  });
});
