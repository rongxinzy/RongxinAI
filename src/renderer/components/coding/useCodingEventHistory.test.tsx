// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  CodingEventKind,
  CodingLaneStatus,
  type CodingAgentLane,
  type CodingEvent,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import { useCodingEventHistory } from './useCodingEventHistory';

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');
afterEach(() => {
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

const lane = (id: string, scrollPosition: number): CodingAgentLane => ({
  id,
  missionId: 'mission-1',
  profileId: 'profile-1',
  modelOverride: null,
  sourceRoot: '/w',
  executionRoot: '/w',
  configOptions: [],
  availableCommands: [],
  localSessionId: 'local-1',
  remoteSessionId: null,
  status: CodingLaneStatus.Idle,
  draft: '',
  scrollPosition,
  pendingRecoveryPrompt: null,
  pendingRecoveryContext: null,
});

const event = (id: string, sequence: number): CodingEvent => ({
  id,
  laneId: 'lane-1',
  sequence,
  kind: CodingEventKind.Message,
  payload: {},
  createdAt: sequence,
});

const baseSnapshot = (activeLane: CodingAgentLane): CodingRoomSnapshot => ({
  room: {
    id: 'room-1',
    name: 'room-1',
    workspaceRoot: '/w',
    defaultProfileId: 'profile-1',
    activeMissionId: 'mission-1',
    activeLaneId: activeLane.id,
  },
  profiles: [],
  missions: [],
  assignments: [],
  elicitations: [],
  lanes: [activeLane],
  events: [event('e5', 5), event('e6', 6)],
  eventWindows: [{ laneId: 'lane-1', oldestSequence: 5, newestSequence: 6, hasMore: true }],
});

const mountViewport = () => {
  const stream = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'coding-conversation-scroll';
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1000 });
  viewport.scrollTop = 700;
  stream.appendChild(viewport);
  document.body.appendChild(stream);
  return { eventStreamRef: { current: stream }, viewport };
};

function setup(activeLane: CodingAgentLane) {
  const loadEventPage = vi.fn(async () => ({
    success: true,
    page: {
      laneId: 'lane-1',
      // Backend pages arrive newest-first; the loader consumes events[0] as
      // the next cursor (see the window assertion below).
      events: [event('e4', 4), event('e3', 3), event('e2', 2), event('e1', 1)],
      hasMore: false,
      nextCursor: null,
    },
  }));
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { codingAgent: { loadEventPage } },
  });
  const { eventStreamRef, viewport } = mountViewport();
  const view = renderHook(
    ({ lane }: { lane: CodingAgentLane }) => {
      const [snapshot, setSnapshot] = useState<CodingRoomSnapshot | null>(() => baseSnapshot(lane));
      const history = useCodingEventHistory({
        workspaceRoot: '/w',
        snapshot,
        activeLane: lane,
        setSnapshot,
        eventStreamRef,
      });
      return { history, snapshot };
    },
    { initialProps: { lane: activeLane } },
  );
  return { eventStreamRef, loadEventPage, view, viewport };
}

const flushFrames = () => {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(0);
};

test('restores the lane scroll position only when the lane id changes', () => {
  const first = lane('lane-1', 240);
  const { view, viewport } = setup(first);

  flushFrames();
  expect(viewport.scrollTop).toBe(240);

  // Streamed snapshot updates recreate the lane object; the position is not
  // re-applied, so the user's scrolling wins.
  viewport.scrollTop = 999;
  act(() => view.rerender({ lane: { ...first, draft: 'typed' } }));
  flushFrames();
  expect(viewport.scrollTop).toBe(999);

  // Switching lanes restores that lane's saved position.
  act(() => view.rerender({ lane: lane('lane-2', 80) }));
  flushFrames();
  expect(viewport.scrollTop).toBe(80);
});

test('merges older event pages, deduplicates and updates the window cursor', async () => {
  const { loadEventPage, view } = setup(lane('lane-1', 0));

  await act(async () => {
    await view.result.current.history.loadOlderEvents();
  });

  expect(loadEventPage).toHaveBeenCalledWith({
    workspaceRoot: '/w',
    laneId: 'lane-1',
    beforeSequence: 5,
  });
  const events = view.result.current.snapshot?.events ?? [];
  expect(events.map(item => item.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  const windowInfo = view.result.current.snapshot?.eventWindows?.[0];
  expect(windowInfo).toMatchObject({ oldestSequence: 4, hasMore: false });

  // The window reports no more history, so further calls are no-ops.
  await act(async () => {
    await view.result.current.history.loadOlderEvents();
  });
  expect(loadEventPage).toHaveBeenCalledTimes(1);
});

test('keeps the distance from the bottom while loading older events', async () => {
  const { eventStreamRef, view, viewport } = setup(lane('lane-1', 0));

  await act(async () => {
    await view.result.current.history.loadOlderEvents();
  });

  flushFrames();
  expect(viewport.scrollTop).toBe(viewport.scrollHeight - 300);
  expect(eventStreamRef.current).toBeDefined();
});
