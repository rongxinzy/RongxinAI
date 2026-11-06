// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactRole, CoworkArtifactSource } from '../../../../../shared/cowork/artifacts';
import { FileInfoFallback } from './FileInfoFallback';

vi.mock('@/services/i18n', () => ({
  i18nService: {
    t: (key: string) => key,
  },
}));

afterEach(cleanup);

test('renders empty state layout with standard Lucide icon and title', () => {
  const artifact = {
    id: 'art-1',
    sessionId: 'session-1',
    messageId: 'msg-1',
    type: 'document' as const,
    title: 'Presentation Deck',
    fileName: 'deck.pptx',
    filePath: '/tmp/deck.pptx',
    role: CoworkArtifactRole.Deliverable,
    source: CoworkArtifactSource.ToolEffect,
    content: '',
    createdAt: Date.now(),
  };

  const { container } = render(<FileInfoFallback artifact={artifact} />);

  expect(screen.getByText('deck.pptx')).toBeDefined();
  expect(screen.getByText('PPTX')).toBeDefined();
  expect(screen.getByRole('button', { name: 'artifactOpenWithApp' })).toBeDefined();

  // Verify Empty container and icon slot are present
  expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  expect(container.querySelector('[data-slot="empty-icon"]')).not.toBeNull();
  // Ensure no raw emojis
  expect(container.textContent).not.toContain('📊');
});
