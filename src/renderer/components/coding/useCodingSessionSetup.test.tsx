// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { CodingWorkspaceSummary } from '../../../shared/codingAgent';
import { CodingUiEvent } from './constants';
import { useCodingSessionSetup } from './useCodingSessionSetup';

const workspace: CodingWorkspaceSummary = {
  id: 'ws-1',
  name: 'workspace',
  primaryRoot: '/w',
  defaultProfileId: 'profile-1',
  sources: [{ id: 'source-1', workspaceId: 'ws-1', path: '/w/main', isPrimary: true }],
  sessions: [],
  activeSessionId: null,
};

const dispatchCreateSession = (detail: { workspace: CodingWorkspaceSummary; profileId?: string }) =>
  window.dispatchEvent(new CustomEvent(CodingUiEvent.CreateSession, { detail }));

const renderSetup = (selectionKey = '/w|lane-1') => {
  const onSessionDraftCreated = vi.fn();
  const view = renderHook(
    ({ key }: { key: string }) =>
      useCodingSessionSetup({ selectionKey: key, onSessionDraftCreated }),
    { initialProps: { key: selectionKey } },
  );
  return { onSessionDraftCreated, view };
};

test('opens the session setup dialog when no profile is preselected', () => {
  const { onSessionDraftCreated, view } = renderSetup();

  act(() => dispatchCreateSession({ workspace }));
  expect(view.result.current.sessionSetupWorkspace).toEqual(workspace);
  expect(onSessionDraftCreated).not.toHaveBeenCalled();

  act(() => view.result.current.closeSessionSetup());
  expect(view.result.current.sessionSetupWorkspace).toBe(null);
});

test('skips the dialog and creates the draft directly when a profile is preselected', () => {
  const { onSessionDraftCreated, view } = renderSetup();

  act(() => dispatchCreateSession({ workspace, profileId: 'profile-2' }));

  expect(view.result.current.sessionSetupWorkspace).toBe(null);
  expect(onSessionDraftCreated).toHaveBeenCalledTimes(1);
  expect(onSessionDraftCreated).toHaveBeenCalledWith({
    workspaceId: 'ws-1',
    workspaceRoot: '/w',
    laneId: null,
    draft: {
      id: expect.any(String),
      workspaceId: 'ws-1',
      sourceRoot: '/w/main',
      profileId: 'profile-2',
      modelOverride: null,
      sources: workspace.sources,
    },
  });
});

test('submits the dialog with the chosen profile and source root', () => {
  const { onSessionDraftCreated, view } = renderSetup();

  act(() => dispatchCreateSession({ workspace }));
  act(() =>
    view.result.current.submitSessionSetup(workspace, {
      profileId: 'profile-3',
      sourceRoot: '/w/src',
    }),
  );

  expect(onSessionDraftCreated).toHaveBeenCalledWith({
    workspaceId: 'ws-1',
    workspaceRoot: '/w',
    laneId: null,
    draft: {
      id: expect.any(String),
      workspaceId: 'ws-1',
      sourceRoot: '/w/src',
      profileId: 'profile-3',
      modelOverride: null,
      sources: workspace.sources,
    },
  });
  expect(view.result.current.sessionSetupWorkspace).toBe(null);
});

test('closes the dialog when the selection changes while it is open', () => {
  const { view } = renderSetup();

  act(() => dispatchCreateSession({ workspace }));
  expect(view.result.current.sessionSetupWorkspace).toEqual(workspace);

  act(() => view.rerender({ key: '/w|lane-2' }));
  expect(view.result.current.sessionSetupWorkspace).toBe(null);

  // Reopening with the new selection keeps the dialog open until closed.
  act(() => dispatchCreateSession({ workspace }));
  act(() => view.rerender({ key: '/w|lane-2' }));
  expect(view.result.current.sessionSetupWorkspace).toEqual(workspace);
});
