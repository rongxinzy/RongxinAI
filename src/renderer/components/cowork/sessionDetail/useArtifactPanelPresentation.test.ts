// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { activateSessionArtifactView } from '../../../store/slices/artifactSlice';
import { useArtifactPanelPresentation } from './useArtifactPanelPresentation';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('react-redux', () => ({ useDispatch: () => mocks.dispatch }));

let rafQueue: FrameRequestCallback[] = [];

const flushAnimationFrames = () => {
  const queue = rafQueue;
  rafQueue = [];
  act(() => {
    queue.forEach(callback => callback(0));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.dispatch.mockReset();
});

afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderPanel = (initialProps: { isPanelOpen: boolean; sessionId: string }) => {
  const contentRowRef = React.createRef<HTMLDivElement>();
  return renderHook(
    (props: { isPanelOpen: boolean; sessionId: string }) =>
      useArtifactPanelPresentation({ ...props, contentRowRef }),
    { initialProps },
  );
};

test('keeps an initially open panel mounted without a transition', () => {
  const { result } = renderPanel({ isPanelOpen: true, sessionId: 'session-1' });

  expect(result.current.shouldRenderArtifactPanel).toBe(true);
  expect(result.current.isArtifactPanelVisible).toBe(true);
  expect(result.current.isArtifactPanelTransitioning).toBe(false);
  expect(result.current.previewSessionId).toBe('session-1');
  expect(result.current.artifactPanelMaxWidth).toBeGreaterThan(0);
  expect(mocks.dispatch).toHaveBeenCalledWith(activateSessionArtifactView('session-1'));
});

test('unmounts the panel only after the close transition ends', () => {
  const { result, rerender } = renderPanel({ isPanelOpen: true, sessionId: 'session-1' });

  act(() => {
    rerender({ isPanelOpen: false, sessionId: 'session-1' });
  });

  // Closing hides immediately but keeps the panel mounted for the transition.
  expect(result.current.shouldRenderArtifactPanel).toBe(true);
  expect(result.current.isArtifactPanelVisible).toBe(false);
  expect(result.current.isArtifactPanelTransitioning).toBe(true);

  act(() => {
    vi.advanceTimersByTime(200);
  });

  expect(result.current.shouldRenderArtifactPanel).toBe(false);
  expect(result.current.isArtifactPanelTransitioning).toBe(false);
  expect(result.current.previewSessionId).toBeNull();
});

test('plays the open transition across two animation frames', () => {
  const { result, rerender } = renderPanel({ isPanelOpen: false, sessionId: 'session-1' });

  act(() => {
    rerender({ isPanelOpen: true, sessionId: 'session-1' });
  });

  expect(result.current.shouldRenderArtifactPanel).toBe(true);
  expect(result.current.isArtifactPanelVisible).toBe(false);
  expect(result.current.isArtifactPanelTransitioning).toBe(true);

  flushAnimationFrames();
  expect(result.current.isArtifactPanelVisible).toBe(false);

  flushAnimationFrames();
  expect(result.current.isArtifactPanelVisible).toBe(true);
  expect(result.current.isArtifactPanelTransitioning).toBe(true);

  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(result.current.isArtifactPanelTransitioning).toBe(false);
});

test('switching sessions snaps the panel to its new state without a transition', () => {
  const { result, rerender } = renderPanel({ isPanelOpen: true, sessionId: 'session-1' });

  act(() => {
    rerender({ isPanelOpen: true, sessionId: 'session-2' });
  });

  expect(result.current.shouldRenderArtifactPanel).toBe(true);
  expect(result.current.isArtifactPanelVisible).toBe(true);
  expect(result.current.isArtifactPanelTransitioning).toBe(false);
  expect(result.current.previewSessionId).toBe('session-2');
  expect(mocks.dispatch).toHaveBeenCalledWith(activateSessionArtifactView('session-2'));
});
