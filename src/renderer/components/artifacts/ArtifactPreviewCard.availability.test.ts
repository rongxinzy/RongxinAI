// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../../shared/cowork/artifacts';
import type { RootState } from '../../store';
import { ArtifactRole, type Artifact } from '../../types/artifact';
import { selectArtifact } from '../../store/slices/artifactSlice';
import ArtifactPreviewCard from './ArtifactPreviewCard';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  error: vi.fn(),
  state: { current: undefined as unknown as RootState },
}));
vi.mock('react-redux', () => ({
  useDispatch: () => mocks.dispatch,
  useSelector: (selector: (state: RootState) => unknown) => selector(mocks.state.current),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@/services/i18n', () => ({ i18nService: { t: (key: string) => key } }));

const cardState = (sessionId = 'session') =>
  ({
    artifact: {
      isPanelOpen: false,
      selectedArtifactId: null,
      activeSessionId: sessionId,
      artifactsBySession: {},
    },
    cowork: { currentSession: { id: sessionId, cwd: 'C:/workspace' } },
  }) as unknown as RootState;

mocks.state.current = cardState();
afterEach(() => {
  mocks.state.current = cardState();
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

const pendingCheck = () => {
  let finish!: (result: { success: boolean }) => void;
  vi.stubGlobal('electron', {
    dialog: {
      checkArtifactFile: () =>
        new Promise<{ success: boolean }>(resolve => {
          finish = resolve;
        }),
    },
  });
  return (result: { success: boolean }) => finish(result);
};

test('does not open a deleted file even if its preview content was cached', async () => {
  vi.stubGlobal('electron', { dialog: { checkArtifactFile: async () => ({ success: false }) } });
  render(createElement(ArtifactPreviewCard, { artifact: { ...artifact, content: 'cached' } }));
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('fileNotFound'));
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

test('keeps preview disabled until the availability check finishes', async () => {
  const finishCheck = pendingCheck();
  render(createElement(ArtifactPreviewCard, { artifact }));
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toBeDisabled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await act(async () => finishCheck({ success: true }));
  expect(mocks.dispatch).toHaveBeenCalledWith(selectArtifact(artifact.id));
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

test('ignores a probe that answers after the card unmounts', async () => {
  const finishCheck = pendingCheck();
  const { unmount } = render(createElement(ArtifactPreviewCard, { artifact }));
  fireEvent.click(screen.getByRole('button'));
  unmount();
  await act(async () => finishCheck({ success: true }));
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

test('ignores a probe that answers after the session changed', async () => {
  const finishCheck = pendingCheck();
  const { rerender } = render(createElement(ArtifactPreviewCard, { artifact }));
  fireEvent.click(screen.getByRole('button'));
  mocks.state.current = cardState('other-session');
  rerender(createElement(ArtifactPreviewCard, { artifact }));
  await act(async () => finishCheck({ success: true }));
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

test('ignores a probe that answers after the card switched artifact', async () => {
  const finishCheck = pendingCheck();
  const { rerender } = render(createElement(ArtifactPreviewCard, { artifact }));
  fireEvent.click(screen.getByRole('button'));
  rerender(createElement(ArtifactPreviewCard, { artifact: { ...artifact, id: 'other-file' } }));
  await act(async () => finishCheck({ success: true }));
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
