// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DesktopPetTaskResult } from '../../shared/desktopPet/constants';
import type { DesktopPetTaskOpen } from '../../shared/desktopPet/types';
import { MainView } from './constants';
import { useDesktopPetNavigation } from './useDesktopPetNavigation';

const mocks = vi.hoisted(() => ({
  current: null as string | null,
  load: vi.fn(),
  error: vi.fn(),
  dispatch: vi.fn(),
  refreshWorkspaces: vi.fn(async () => {}),
}));
vi.mock('../services/cowork', () => ({ coworkService: { loadSession: mocks.load } }));
vi.mock('../services/workspace', () => ({
  workspaceService: { refreshWorkspaces: mocks.refreshWorkspaces },
}));
vi.mock('../services/appToast', () => ({ showAppError: mocks.error }));
vi.mock('../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../store', () => ({
  store: {
    getState: () => ({ cowork: { currentSessionId: mocks.current } }),
    dispatch: mocks.dispatch,
  },
}));

let listener: (request: DesktopPetTaskOpen) => void;
const api = {
  onOpenTask: vi.fn((callback: typeof listener) => {
    listener = callback;
    return vi.fn();
  }),
  getPendingTask: vi.fn<() => Promise<DesktopPetTaskOpen | null>>(),
  resolveTask: vi.fn(async () => {}),
};
const getSession = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = null;
  mocks.load.mockImplementation(async (id: string) => {
    mocks.current = id;
    return { id, mode: 'work' };
  });
  api.getPendingTask.mockResolvedValue(null);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { desktopPet: api, cowork: { getSession } },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderNavigation(initialReady = true) {
  return renderHook(
    ({ ready }) => {
      const [view, setView] = useState<MainView>(MainView.Settings);
      const [session, setSession] = useState<string | null>(null);
      const show = useCallback(() => {
        setSession(mocks.current);
        setView(MainView.Cowork);
      }, []);
      useDesktopPetNavigation(ready, view, session, show);
      return { view, session };
    },
    { initialProps: { ready: initialReady } },
  );
}

test('waits for app initialization and loads a queued request into the conversation before acknowledging', async () => {
  api.getPendingTask.mockResolvedValue({ requestId: 4, sessionId: 'failed-task' });
  const hook = renderNavigation(false);
  expect(api.getPendingTask).not.toHaveBeenCalled();
  hook.rerender({ ready: true });
  await waitFor(() => expect(api.resolveTask).toHaveBeenCalledWith(4, DesktopPetTaskResult.Opened));
  expect(hook.result.current).toEqual({ view: MainView.Cowork, session: 'failed-task' });
  expect(mocks.refreshWorkspaces).toHaveBeenCalledOnce();
  expect(mocks.refreshWorkspaces.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.load.mock.invocationCallOrder[0],
  );
});

test('a failed load preserves the reminder and does not treat a transport failure as deletion', async () => {
  mocks.load.mockResolvedValue(null);
  getSession.mockResolvedValue({ success: false, error: 'temporary' });
  renderNavigation();
  await act(async () => listener({ requestId: 5, sessionId: 'failed-task' }));
  expect(api.resolveTask).toHaveBeenCalledWith(5, DesktopPetTaskResult.Failed);
  expect(api.resolveTask).not.toHaveBeenCalledWith(5, DesktopPetTaskResult.Missing);
  expect(mocks.error).toHaveBeenCalledOnce();
});

test('only an explicitly missing session is resolved as deleted', async () => {
  mocks.load.mockResolvedValue(null);
  getSession.mockResolvedValue({ success: true, session: null });
  renderNavigation();
  await act(async () => listener({ requestId: 6, sessionId: 'deleted-task' }));
  expect(api.resolveTask).toHaveBeenCalledWith(6, DesktopPetTaskResult.Missing);
});
