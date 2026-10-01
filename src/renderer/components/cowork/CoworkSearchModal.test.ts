// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CoworkSessionSource } from '../../../shared/cowork/constants';
import { WorkMode } from '../../store/workMode/constants';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../../types/cowork';
import CoworkSearchModal from './CoworkSearchModal';

const mocks = vi.hoisted(() => ({
  language: 'zh',
  listeners: new Set<() => void>(),
  streaming: [],
  state: { agent: { agents: [] }, workspace: { workspaces: [] } },
  list: vi.fn(),
}));
vi.mock('react-redux', () => ({
  useSelector: (select: (state: unknown) => unknown) => select(mocks.state),
}));
vi.mock('../../store/selectors/coworkSelectors', () => ({
  selectStreamingSessionIds: () => mocks.streaming,
}));
vi.mock('../../services/config', () => ({ configService: { getConfig: () => ({}) } }));
vi.mock('../../services/cowork', () => ({ coworkService: { listSessionsForSearch: mocks.list } }));
vi.mock('../../services/i18n', () => ({
  i18nService: {
    t: (key: string) => key,
    getLanguage: () => mocks.language,
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  },
}));

const sessions: CoworkSessionSummary[] = [
  {
    id: 'scheduled',
    title: '[定时]日报',
    source: CoworkSessionSource.Scheduled,
    status: CoworkSessionStatusValue.Idle,
    mode: WorkMode.Work,
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = 'zh';
  mocks.list.mockResolvedValue({ success: true, sessions });
  window.electron = { platform: 'win32' } as typeof window.electron;
  Element.prototype.scrollIntoView ??= vi.fn();
});
afterEach(() => {
  cleanup();
  expect(mocks.listeners.size).toBe(0);
});

function switchLanguage(language: string) {
  act(() => {
    mocks.language = language;
    mocks.listeners.forEach(listener => listener());
  });
}

test('refreshes loaded titles on a language change without resetting query, focus or selection', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  render(
    createElement(CoworkSearchModal, {
      isOpen: true,
      onClose: vi.fn(),
      sessions,
      currentSessionId: null,
      onSelectSession: select,
    }),
  );
  await screen.findByRole('option', { name: /\[定时\]日报/ });
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  const input = screen.getByRole('combobox');
  await user.type(input, '日报');
  await user.keyboard('{ArrowDown}');
  const selectedId = input.getAttribute('aria-activedescendant');
  switchLanguage('en');
  await screen.findByRole('option', { name: /\[Cron\]日报/ });
  expect(input).toHaveValue('日报');
  expect(input).toHaveFocus();
  expect(input.getAttribute('aria-activedescendant')).toBe(selectedId);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await user.keyboard('{Enter}');
  expect(select).toHaveBeenCalledWith(sessions[0]);
});

test('re-evaluates prefix filtering immediately and unsubscribes on unmount', async () => {
  const user = userEvent.setup();
  const view = render(
    createElement(CoworkSearchModal, {
      isOpen: true,
      onClose: vi.fn(),
      sessions,
      currentSessionId: null,
      onSelectSession: vi.fn(),
    }),
  );
  await screen.findByRole('option', { name: /\[定时\]日报/ });
  await user.type(screen.getByRole('combobox'), '定时');
  switchLanguage('en');
  expect(screen.queryByRole('option', { name: /日报/ })).toBeNull();
  expect(screen.getByRole('combobox')).toHaveValue('定时');
  switchLanguage('zh');
  expect(screen.getByRole('option', { name: /\[定时\]日报/ })).toBeTruthy();
  view.unmount();
  expect(mocks.listeners.size).toBe(0);
});
