// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ArtifactPanelView } from '../../store/slices/artifactSlice';
import type { Artifact } from '../../types/artifact';
import { useArtifactPreviewContent } from './useArtifactPreviewContent';

vi.mock('react-redux', () => ({ useDispatch: () => vi.fn() }));

test('file-backed images skip the buffered reader, including explicit refresh', async () => {
  const readFileAsDataUrl = vi.fn();
  Object.assign(window, { electron: { dialog: { readFileAsDataUrl } } });
  const artifact: Artifact = {
    id: 'image',
    sessionId: 'session',
    messageId: 'message',
    title: 'Image',
    type: 'image',
    filePath: '/work/generated.png',
    content: '',
    source: 'tool',
    role: 'deliverable',
    createdAt: 1,
  };
  const { result } = renderHook(() =>
    useArtifactPreviewContent({
      artifact,
      isCodeView: false,
      panelView: ArtifactPanelView.Preview,
    }),
  );
  expect(result.current.loadingArtifactId).toBeNull();
  await act(() => result.current.handleRefresh());
  expect(result.current.imageRevision).toBe(1);
  expect(readFileAsDataUrl).not.toHaveBeenCalled();
});
