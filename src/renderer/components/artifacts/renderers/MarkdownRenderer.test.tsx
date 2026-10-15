// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import * as artifactFileLoader from '@/services/artifactFileLoader';
import { i18nService } from '@/services/i18n';
import { ArtifactRole, type Artifact } from '@/types/artifact';

import MarkdownRenderer from './MarkdownRenderer';

const makeMarkdownArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-md-1',
  messageId: 'message-1',
  sessionId: 'session-1',
  type: 'markdown',
  title: 'test.md',
  content: '',
  fileName: 'test.md',
  filePath: '',
  source: 'tool',
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 0,
  ...overrides,
});

describe('MarkdownRenderer', () => {
  test('shows document error when content and filePath are both missing', () => {
    render(<MarkdownRenderer artifact={makeMarkdownArtifact()} />);

    expect(screen.getByText(i18nService.t('artifactDocumentError'))).toBeTruthy();
  });

  test('renders markdown content directly when provided', () => {
    render(<MarkdownRenderer artifact={makeMarkdownArtifact({ content: '# Hello World' })} />);

    expect(screen.getByText('Hello World')).toBeTruthy();
  });

  test('loads content via loadArtifactFile when filePath is provided', async () => {
    vi.spyOn(artifactFileLoader, 'loadArtifactFile').mockResolvedValueOnce({
      content: '## Loaded via loader',
      filePath: '/path/to/test.md',
    });

    render(<MarkdownRenderer artifact={makeMarkdownArtifact({ filePath: '/path/to/test.md' })} />);

    expect(await screen.findByText('Loaded via loader')).toBeTruthy();
  });
});
