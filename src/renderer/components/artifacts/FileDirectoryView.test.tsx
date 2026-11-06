// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactRole, CoworkArtifactSource } from '../../../shared/cowork/artifacts';
import FileDirectoryView from './FileDirectoryView';

vi.mock('@/services/i18n', () => ({
  i18nService: {
    t: (key: string) => key,
  },
}));

afterEach(cleanup);

const mockArtifacts = [
  {
    id: 'art-1',
    sessionId: 'session-1',
    messageId: 'msg-1',
    type: 'html' as const,
    title: 'Landing Page',
    fileName: 'index.html',
    filePath: '/tmp/project/index.html',
    role: CoworkArtifactRole.Deliverable,
    source: CoworkArtifactSource.ToolEffect,
    content: '<h1>Hello</h1>',
    createdAt: Date.now(),
  },
  {
    id: 'art-2',
    sessionId: 'session-1',
    messageId: 'msg-2',
    type: 'document' as const,
    title: 'Financial Model',
    fileName: 'model.xlsx',
    filePath: '/tmp/project/model.xlsx',
    role: CoworkArtifactRole.Deliverable,
    source: CoworkArtifactSource.ToolEffect,
    content: '',
    createdAt: Date.now(),
  },
];

test('renders file rows as buttons and selects on click', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();

  render(<FileDirectoryView artifacts={mockArtifacts} selectedId="art-1" onSelect={onSelect} />);

  const buttons = screen.getAllByRole('button');
  expect(buttons.length).toBe(2);
  expect(screen.getByText('index.html')).toBeDefined();
  expect(screen.getByText('model.xlsx')).toBeDefined();

  await user.click(screen.getByText('model.xlsx'));
  expect(onSelect).toHaveBeenCalledWith('art-2');
});

test('renders empty state when no artifacts are present', () => {
  render(<FileDirectoryView artifacts={[]} selectedId={null} onSelect={vi.fn()} />);

  expect(screen.getByText('artifactEmptyFiles')).toBeDefined();
});
