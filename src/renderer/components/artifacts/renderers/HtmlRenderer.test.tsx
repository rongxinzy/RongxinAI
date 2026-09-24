// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { i18nService } from '@/services/i18n';
import { ArtifactRole, type Artifact } from '@/types/artifact';

import HtmlRenderer, { ensurePreviewColorScheme, injectPreviewNavigationGuard } from './HtmlRenderer';

const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-1',
  messageId: 'message-1',
  sessionId: 'session-1',
  type: 'html',
  title: 'broken.html',
  content: '',
  fileName: 'broken.html',
  filePath: '',
  source: 'tool',
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 0,
  ...overrides,
});

describe('HtmlRenderer', () => {
  test('shows an error instead of loading forever when there is nothing to load', () => {
    render(<HtmlRenderer artifact={makeArtifact()} />);

    expect(screen.getByText(i18nService.t('artifactDocumentError'))).toBeTruthy();
  });
});
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
