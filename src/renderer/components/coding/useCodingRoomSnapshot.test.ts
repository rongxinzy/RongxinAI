// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  CodingLaneStatus,
  type CodingRoomSnapshot,
  type CodingRoomEventDelta,
} from '../../../shared/codingAgent';
import { useCodingRoomSnapshot } from './useCodingRoomSnapshot';

vi.mock('../../services/appErrorText', () => ({
  reportAppError: (error: unknown, fallback: string) => String(error ?? fallback),
}));
const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');
afterEach(() => {
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

function snapshot(root: string): CodingRoomSnapshot {
  return {
    room: {
      id: root,
      name: root,
      workspaceRoot: root,
      defaultProfileId: '',
      activeMissionId: null,
      activeLaneId: null,
    },
    profiles: [],
    missions: [],
    assignments: [],
    events: [],
    elicitations: [],
    lanes: [
      {
        id: `${root}-lane`,
        missionId: '',
        profileId: '',
        modelOverride: null,
        sourceRoot: root,
        executionRoot: root,
        configOptions: [],
        availableCommands: [],
        localSessionId: '',
        remoteSessionId: null,
        status: CodingLaneStatus.Idle,
        draft: '',
        scrollPosition: 0,
        pendingRecoveryPrompt: null,
        pendingRecoveryContext: null,
      },
    ],
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup() {
  const bootstrap = vi.fn(async (root: string) => ({ success: true, snapshot: snapshot(root) }));
  const selectLane = vi.fn(
    async ({
      workspaceRoot,
      laneId,
    }: {
      workspaceRoot: string;
      laneId: string;
    }): Promise<{
      success: boolean;
      snapshot: CodingRoomSnapshot;
    }> => ({
      success: true,
      snapshot: {
        ...snapshot(workspaceRoot),
        room: { ...snapshot(workspaceRoot).room, activeLaneId: laneId },
      },
    }),
  );
  const snapshotListeners: ((next: CodingRoomSnapshot) => void)[] = [];
  const deltaListeners: ((next: CodingRoomEventDelta) => void)[] = [];
  const unsubscribe = vi.fn();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      codingAgent: {
        bootstrap,
        selectLane,
        onChanged: (callback: (next: CodingRoomSnapshot) => void) => {
          snapshotListeners.push(callback);
          return unsubscribe;
        },
        onEventDelta: (callback: (next: CodingRoomEventDelta) => void) => {
          deltaListeners.push(callback);
          return unsubscribe;
        },
      },
    },
  });
  const onError = vi.fn();
  const view = renderHook(
    ({ root, lane, attempt }) => useCodingRoomSnapshot(root, lane, attempt, onError),
    {
      initialProps: { root: '/A', lane: null as string | null, attempt: 0 },
    },
  );
  return {
    ...view,
    bootstrap,
    selectLane,
    onError,
    snapshotListeners,
    deltaListeners,
    unsubscribe,
  };
}

test('switching workspace immediately hides the old snapshot and exposes bootstrap failures', async () => {
  const { result, rerender, bootstrap } = setup();
  await waitFor(() => expect(result.current.snapshot?.room.workspaceRoot).toBe('/A'));
  const pending = deferred<Awaited<ReturnType<typeof bootstrap>>>();
  bootstrap.mockImplementationOnce(() => pending.promise);
  rerender({ root: '/B', lane: null, attempt: 0 });
  expect(result.current.snapshot).toBeNull();
  await act(async () => pending.resolve({ success: false, snapshot: snapshot('/B') }));
  expect(result.current.snapshot).toBeNull();
  expect(result.current.bootstrapError).toBe('codingAgentActionFailed');
  rerender({ root: '/B', lane: null, attempt: 1 });
  await waitFor(() => expect(result.current.snapshot?.room.workspaceRoot).toBe('/B'));
  expect(result.current.bootstrapError).toBeNull();
});

test('a late selectLane response cannot overwrite the next workspace', async () => {
  const { result, rerender, selectLane } = setup();
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const pending = deferred<Awaited<ReturnType<typeof selectLane>>>();
  selectLane.mockImplementationOnce(() => pending.promise);
  rerender({ root: '/A', lane: '/A-lane', attempt: 0 });
  expect(selectLane).toHaveBeenCalled();
  rerender({ root: '/B', lane: null, attempt: 0 });
  await waitFor(() => expect(result.current.snapshot?.room.workspaceRoot).toBe('/B'));
  await act(async () => pending.resolve({ success: true, snapshot: snapshot('/A') }));
  expect(result.current.snapshot?.room.workspaceRoot).toBe('/B');
});

test('old setters remain invalid after returning to the same workspace', async () => {
  const { result, rerender } = setup();
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const oldSetter = result.current.setSnapshot;
  const oldScopeIsCurrent = result.current.isCurrentWorkspace;
  rerender({ root: '/B', lane: null, attempt: 0 });
  rerender({ root: '/A', lane: null, attempt: 0 });
  await waitFor(() => expect(result.current.snapshot?.room.workspaceRoot).toBe('/A'));
  expect(oldScopeIsCurrent()).toBe(false);
  expect(result.current.isCurrentWorkspace()).toBe(true);
  act(() => oldSetter({ ...snapshot('/A'), room: { ...snapshot('/A').room, name: 'stale' } }));
  expect(result.current.snapshot?.room.name).toBe('/A');
});

test('a setter rejects foreign snapshots and old functional updates', async () => {
  const { result, rerender } = setup();
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  act(() => result.current.setSnapshot(snapshot('/B')));
  expect(result.current.snapshot?.room.workspaceRoot).toBe('/A');
  const oldSetter = result.current.setSnapshot;
  const update = vi.fn(() => snapshot('/A'));
  rerender({ root: '/B', lane: null, attempt: 0 });
  await waitFor(() => expect(result.current.snapshot?.room.workspaceRoot).toBe('/B'));
  act(() => oldSetter(update));
  expect(update).not.toHaveBeenCalled();
});

test('late bootstrap and subscription callbacks are ignored after switching or unmounting', async () => {
  const { result, rerender, bootstrap, snapshotListeners, deltaListeners, unsubscribe, unmount } =
    setup();
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  const pending = deferred<Awaited<ReturnType<typeof bootstrap>>>();
  bootstrap.mockImplementationOnce(() => pending.promise);
  rerender({ root: '/B', lane: null, attempt: 0 });
  rerender({ root: '/C', lane: null, attempt: 0 });
  await waitFor(() => expect(result.current.snapshot?.room.workspaceRoot).toBe('/C'));
  await act(async () => {
    pending.resolve({ success: true, snapshot: snapshot('/B') });
    snapshotListeners[0](snapshot('/A'));
    deltaListeners[0]({ workspaceRoot: '/A', events: [] });
  });
  expect(result.current.snapshot?.room.workspaceRoot).toBe('/C');
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(6);
  act(() => snapshotListeners[2](snapshot('/C')));
});

test('successful lane selection updates the active lane', async () => {
  const { result, rerender } = setup();
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  rerender({ root: '/A', lane: '/A-lane', attempt: 0 });
  await waitFor(() => expect(result.current.snapshot?.room.activeLaneId).toBe('/A-lane'));
});
