// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../../../shared/cowork/artifacts';
import { type PreparedArtifact } from '../../../services/artifactAvailability';
import { addArtifact } from '../../../store/slices/artifactSlice';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import { usePersistedArtifactSeed } from './usePersistedArtifactSeed';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), prepare: vi.fn() }));
vi.mock('react-redux', () => ({ useDispatch: () => mocks.dispatch }));
vi.mock('../../../services/artifactAvailability', () => ({
  prepareAvailableArtifacts: mocks.prepare,
}));

const artifact: Artifact = {
  id: 'output',
  messageId: 'answer',
  sessionId: 'session',
  type: 'document',
  title: 'result.docx',
  content: '',
  filePath: 'D:/workspace/result.docx',
  source: CoworkArtifactSource.Tool,
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 1,
};
const persisted = [{ ...artifact, declared: true }];
let resolveBatch: (value: PreparedArtifact[]) => void;

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.prepare.mockReset();
  mocks.prepare.mockImplementation(
    () =>
      new Promise<PreparedArtifact[]>(resolve => {
        resolveBatch = resolve;
      }),
  );
});

test('reserves the persisted card immediately and replaces it without duplicate cards after validation', async () => {
  const view = renderHook(
    ({ existing }: { existing: Artifact[] }) =>
      usePersistedArtifactSeed('session', persisted, 'D:/workspace', existing),
    { initialProps: { existing: [] as Artifact[] } },
  );
  expect(view.result.current).toEqual([artifact]);
  await act(async () => resolveBatch([{ artifact, reveal: false }]));
  expect(mocks.dispatch).toHaveBeenCalledWith(addArtifact({ sessionId: 'session', artifact }));
  view.rerender({ existing: [artifact] });
  expect(view.result.current).toEqual([]);
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
});

test('drops a confirmed missing card after the availability gate without publishing it', async () => {
  const view = renderHook(() => usePersistedArtifactSeed('session', persisted, undefined, []));
  expect(view.result.current).toHaveLength(1);
  await act(async () => resolveBatch([]));
  expect(view.result.current).toEqual([]);
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

test('ignores a late probe after switching sessions and reserves the new session independently', async () => {
  const view = renderHook(({ id }) => usePersistedArtifactSeed(id, persisted, undefined, []), {
    initialProps: { id: 'session' },
  });
  const resolveOld = resolveBatch;
  view.rerender({ id: 'other-session' });
  expect(view.result.current[0].sessionId).toBe('other-session');
  await act(async () => resolveOld([{ artifact, reveal: false }]));
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(view.result.current).toHaveLength(1);
});
