// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { i18nService } from '@/services/i18n';
import { ArtifactRole, type Artifact } from '@/types/artifact';

import DxfRenderer from './DxfRenderer';
import { MAX_PREVIEW_DXF_CHARS } from './constants';

const SAMPLE_DXF = `0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
10
21
0
0
ENDSEC
0
EOF
`;

const makeDxfArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-dxf-1',
  messageId: 'message-1',
  sessionId: 'session-1',
  type: 'document',
  title: 'test.dxf',
  content: '',
  fileName: 'test.dxf',
  filePath: '',
  source: 'tool',
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 0,
  ...overrides,
});

describe('DxfRenderer', () => {
  test('shows an error instead of loading forever when artifact content and path are missing', async () => {
    render(<DxfRenderer artifact={makeDxfArtifact()} />);

    expect(await screen.findByText(i18nService.t('artifactDocumentError'))).toBeTruthy();
  });

  test('skips preview for oversized DXF content to protect main thread', async () => {
    render(
      <DxfRenderer
        artifact={makeDxfArtifact({ content: 'x'.repeat(MAX_PREVIEW_DXF_CHARS + 1) })}
      />,
    );

    expect(await screen.findByText(i18nService.t('artifactPreviewTooLarge'))).toBeTruthy();
  });

  test('renders sanitized SVG for valid DXF content', async () => {
    const { container } = render(
      <DxfRenderer artifact={makeDxfArtifact({ content: SAMPLE_DXF })} />,
    );

    // Check svg and line tags in container
    expect(
      (await screen.findByRole('img', { hidden: true }).catch(() => null)) ||
        container.querySelector('svg'),
    ).toBeTruthy();
    expect(container.querySelector('line')).toBeTruthy();
  });
});
