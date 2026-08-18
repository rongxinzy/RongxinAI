import { expect, test } from 'vitest';

import { CoworkSessionMode, CoworkSessionSource } from '../../../shared/cowork/constants';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import {
  isSessionOwnedByWorkspace,
  mergeSessionsIntoWorkspacePreviews,
} from './workspaceSessionPreviews';

const makeSession = (id: string, workspaceId: string): CoworkSessionSummary => ({
  id,
  workspaceId,
  title: id,
  status: CoworkSessionStatusValue.Completed,
  mode: CoworkSessionMode.Work,
  pinned: false,
  source: CoworkSessionSource.Manual,
  createdAt: 1,
  updatedAt: 1,
});

test('merges each session into its own workspace preview', () => {
  const workspaceA = makeSession('session-a', 'workspace-a');
  const workspaceB = makeSession('session-b', 'workspace-b');
  const workspaceAUpdate = { ...workspaceA, updatedAt: 2 };

  const previews = mergeSessionsIntoWorkspacePreviews(
    {
      'workspace-a': [workspaceA],
      'workspace-b': [],
    },
    [workspaceB, workspaceAUpdate],
  );

  expect(previews['workspace-a']).toEqual([workspaceAUpdate]);
  expect(previews['workspace-b'].map(session => session.id)).toEqual(['session-b']);
});

test('removes incorrectly owned sessions when a workspace preview is refreshed', () => {
  const workspaceA = makeSession('session-a', 'workspace-a');
  const workspaceB = makeSession('session-b', 'workspace-b');

  const previews = mergeSessionsIntoWorkspacePreviews(
    {
      'workspace-b': [workspaceA],
    },
    [workspaceB],
  );

  expect(previews['workspace-b']).toEqual([workspaceB]);
  expect(isSessionOwnedByWorkspace(workspaceA, 'workspace-b')).toBe(false);
});

test('drops stale temp-* sessions that left the session list', () => {
  const ghost = makeSession('temp-1786533458865', 'workspace-a');
  const real = makeSession('session-a', 'workspace-a');

  const previews = mergeSessionsIntoWorkspacePreviews(
    {
      'workspace-a': [ghost, real],
    },
    [real],
  );

  expect(previews['workspace-a'].map(session => session.id)).toEqual(['session-a']);
});

test('never lets a temp-* session enter the preview even while it is in the list', () => {
  const temp = makeSession('temp-1786533458865', 'workspace-a');
  const real = makeSession('session-a', 'workspace-a');

  const previews = mergeSessionsIntoWorkspacePreviews(
    {
      'workspace-a': [temp, real],
    },
    [temp, real],
  );

  expect(previews['workspace-a'].map(session => session.id)).toEqual(['session-a']);
});

test('keeps backend-loaded real sessions not present in the session list', () => {
  const backendOnly = makeSession('session-b', 'workspace-a');

  const previews = mergeSessionsIntoWorkspacePreviews(
    {
      'workspace-a': [backendOnly],
    },
    [],
  );

  expect(previews['workspace-a'].map(session => session.id)).toEqual(['session-b']);
});
