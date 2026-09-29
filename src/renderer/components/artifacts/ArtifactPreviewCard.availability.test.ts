// @vitest-environment jsdom
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../../shared/cowork/artifacts';
import { ArtifactRole, type Artifact } from '../../types/artifact';
import { selectArtifact } from '../../store/slices/artifactSlice';
import ArtifactPreviewCard from './ArtifactPreviewCard';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), error: vi.fn() }));
vi.mock('react-redux', () => ({ useDispatch: () => mocks.dispatch, useSelector: () => null }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@/services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const artifact: Artifact = {
  id: 'file',
  messageId: 'answer',
  sessionId: 'session',
  type: 'document',
  title: 'report.pptx',
  filePath: 'C:/workspace/report.pptx',
  content: '',
  source: CoworkArtifactSource.Tool,
  role: ArtifactRole.Deliverable,
  createdAt: 1,
};

test('does not open a deleted file even if its preview content was cached', async () => {
  vi.stubGlobal('electron', { dialog: { checkArtifactFile: async () => ({ success: false }) } });
  render(createElement(ArtifactPreviewCard, { artifact: { ...artifact, content: 'cached' } }));
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('fileNotFound'));
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

test('keeps preview disabled until the availability check finishes', async () => {
  let finish!: (result: { success: boolean }) => void;
  vi.stubGlobal('electron', {
    dialog: {
      checkArtifactFile: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    },
  });
  render(createElement(ArtifactPreviewCard, { artifact }));
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toBeDisabled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  finish({ success: true });
  await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(selectArtifact(artifact.id)));
  expect(screen.getByRole('button')).toBeEnabled();
});

test('does not call the shell for a missing file', async () => {
  const showItemInFolder = vi.fn();
  vi.stubGlobal('electron', {
    dialog: { checkArtifactFile: async () => ({ success: false }) },
    shell: { showItemInFolder },
  });
  render(createElement(ArtifactPreviewCard, { artifact }));
  fireEvent.click(screen.getByRole('link'));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('fileNotFound'));
  expect(showItemInFolder).not.toHaveBeenCalled();
});
