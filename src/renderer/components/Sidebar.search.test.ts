// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import Sidebar from './Sidebar';
import { CoworkSessionSource } from '../../shared/cowork/constants';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../types/cowork';
import { WorkMode } from '../store/workMode/constants';

const mocks = vi.hoisted(() => ({
  mode: 'work',
  listSessionsForSearch: vi.fn(async () => ({
    success: true,
    sessions: [] as CoworkSessionSummary[],
  })),
  dispatch: vi.fn(),
  state: {
    agent: { currentAgentId: 'main', agents: [{ id: 'main', name: 'Main' }] },
    workspace: { workspaces: [{ id: 'workspace', name: 'Project', isHidden: false }] },
  },
  loadSession: vi.fn(async (): Promise<unknown> => ({ id: 'loaded' })),
  loadSessions: vi.fn(async () => {}),
  clearWorkspaceSelection: vi.fn(async () => {}),
  switchAgent: vi.fn(),
  newShortcut: 'CmdOrCtrl+N',
}));
vi.mock('react-redux', () => ({
  useDispatch: () => mocks.dispatch,
  useSelector: (select: (state: unknown) => unknown) => select(mocks.state),
}));
vi.mock('../store', () => ({ store: { getState: () => ({ cowork: { streamingSessions: {} } }) } }));
vi.mock('../store/selectors/coworkSelectors', () => ({
  selectCoworkSessions: () => [],
  selectChatSessions: () => [],
  selectChatSessionsLoaded: () => true,
  selectCurrentSessionId: () => null,
  selectStreamingSessionIds: () => [],
  selectUnreadSessionIds: () => [],
}));
vi.mock('../store/selectors/workModeSelectors', () => ({ selectWorkMode: () => mocks.mode }));
vi.mock('../services/workspace', () => ({
  workspaceService: { clearWorkspaceSelection: mocks.clearWorkspaceSelection },
}));
vi.mock('../services/agent', () => ({ agentService: { switchAgent: mocks.switchAgent } }));
vi.mock('../services/config', () => ({
  configService: {
    updateConfig: vi.fn(),
    getConfig: () => ({ shortcuts: { newChat: mocks.newShortcut } }),
  },
}));
vi.mock('../services/cowork', () => ({
  coworkService: {
    listSessionsForSearch: mocks.listSessionsForSearch,
    loadSession: mocks.loadSession,
    loadSessions: mocks.loadSessions,
  },
}));
vi.mock('../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('./SidebarNavigationControls', () => ({ SidebarNavigationControls: () => null }));
vi.mock('./LoginButton', () => ({ default: () => null }));
vi.mock('./chat/ChatSkillShortcuts', () => ({ default: () => null }));
vi.mock('./coding/CodingWorkspaceSidebar', () => ({ CodingWorkspaceSidebar: () => null }));
vi.mock('./agentSidebar/MyAgentSidebarTree', () => ({
  default: function MockAgentTree({ searchQuery }: { searchQuery: string }) {
    const [value, setValue] = useState('');
    return createElement(
      'div',
      null,
      createElement('output', { 'data-testid': 'filter-query' }, searchQuery),
      createElement('input', {
        'aria-label': 'tree state',
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
      }),
    );
  },
}));
vi.mock('./agentSidebar/AgentTaskRow', () => ({ default: () => null }));

const props = () => ({
  activeView: 'cowork' as const,
  isCollapsed: false,
  hideLogin: true,
  onShowSettings: vi.fn(),
  onShowSkills: vi.fn(),
  onShowCowork: vi.fn(),
  onShowScheduledTasks: vi.fn(),
  onShowActivity: vi.fn(),
  onShowMcp: vi.fn(),
  onShowLocalInference: vi.fn(),
  onShowExpert: vi.fn(),
  onShowCoding: vi.fn(),
  onShowTodo: vi.fn(),
  onNewChat: vi.fn(),
  onToggleCollapse: vi.fn(),
  codingSelection: null as never,
  onCodingSelectionChange: vi.fn(),
});

const sessions: CoworkSessionSummary[] = [
  {
    id: 'first',
    title: 'Same title',
    agentId: 'main',
    workspaceId: 'workspace',
    status: CoworkSessionStatusValue.Idle,
    mode: WorkMode.Work,
    pinned: false,
    source: CoworkSessionSource.Manual,
    createdAt: 1,
    updatedAt: 3,
  },
  {
    id: 'second',
    title: 'Same title',
    agentId: 'specialist',
    status: CoworkSessionStatusValue.Running,
    mode: WorkMode.Work,
    pinned: false,
    source: CoworkSessionSource.Manual,
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: 'chat',
    title: 'Chat result',
    status: CoworkSessionStatusValue.Idle,
    mode: WorkMode.Chat,
    pinned: false,
    source: CoworkSessionSource.Manual,
    createdAt: 1,
    updatedAt: 1,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = WorkMode.Work;
  mocks.newShortcut = 'CmdOrCtrl+N';
  mocks.listSessionsForSearch.mockResolvedValue({ success: true, sessions });
  mocks.loadSession.mockResolvedValue({ id: 'loaded' });
  window.electron = { platform: 'darwin' } as typeof window.electron;
  Element.prototype.scrollIntoView ??= vi.fn();
});

test('opens a modal, filters once-loaded results, and restores focus without changing the tree', async () => {
  const user = userEvent.setup();
  render(createElement(Sidebar, props()));
  const tree = screen.getByRole('textbox', { name: 'tree state' });
  await user.type(tree, 'Keep this');
  const trigger = screen.getByRole('button', { name: 'search' });
  await user.click(trigger);
  const modal = screen.getByRole('dialog');
  const input = within(modal).getByRole('combobox', { name: 'searchConversations' });
  expect(input).toHaveFocus();
  await screen.findByRole('option', { name: /Same title Project/ });
  await user.type(input, 'specialist');
  expect(within(modal).getAllByRole('option')).toHaveLength(2);
  expect(within(modal).queryByText('Project')).toBeNull();
  await user.clear(input);
  expect(mocks.listSessionsForSearch).toHaveBeenCalledTimes(1);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.getByRole('textbox', { name: 'tree state' })).toHaveValue('Keep this');
});

test('opens duplicate-titled tasks by stable id and preserves cross-agent navigation', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(Sidebar, handlers));
  await user.click(screen.getByRole('button', { name: 'search' }));
  await screen.findByRole('option', { name: /Same title specialist/ });
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(mocks.loadSession).toHaveBeenCalledWith('second'));
  expect(mocks.switchAgent).toHaveBeenCalledWith('specialist');
  expect(mocks.loadSessions).toHaveBeenCalledWith('specialist');
  expect(handlers.onShowCowork).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('keeps global shortcut usable while collapsed and restores the task draft', async () => {
  const user = userEvent.setup();
  const handlers = props();
  const view = render(
    createElement(
      'div',
      null,
      createElement(Sidebar, { ...handlers, isCollapsed: true }),
      createElement('input', { 'aria-label': 'draft' }),
    ),
  );
  const draft = screen.getByRole('textbox', { name: 'draft' });
  await user.type(draft, 'Keep draft');
  await act(async () => {
    window.dispatchEvent(new Event('cowork:shortcut:search'));
  });
  await screen.findByRole('option', { name: /Same title Project/ });
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  await user.keyboard('{Escape}');
  await waitFor(() => expect(draft).toHaveFocus());
  expect(draft).toHaveValue('Keep draft');
  view.unmount();
});

test('filters chat mode and supports number shortcuts without agent switching', async () => {
  mocks.mode = WorkMode.Chat;
  const user = userEvent.setup();
  render(createElement(Sidebar, props()));
  await user.click(screen.getByRole('button', { name: 'searchChats' }));
  await screen.findByRole('option', { name: /Chat result/ });
  expect(screen.queryByText('Same title')).toBeNull();
  await user.keyboard('{Meta>}1{/Meta}');
  await waitFor(() => expect(mocks.loadSession).toHaveBeenCalledWith('chat'));
  expect(mocks.switchAgent).not.toHaveBeenCalled();
  expect(mocks.loadSessions).not.toHaveBeenCalled();
});

test('keeps new-task behavior and shows an empty search state', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(Sidebar, handlers));
  await user.click(screen.getByRole('button', { name: 'search' }));
  await screen.findByRole('option', { name: /Same title Project/ });
  await user.type(screen.getByRole('combobox'), 'missing');
  expect(screen.getByRole('status')).toHaveTextContent('searchNoResults');
  await user.click(screen.getByRole('option', { name: 'newTask' }));
  expect(mocks.clearWorkspaceSelection).toHaveBeenCalledTimes(1);
  expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
});

test('handles a failed search request and retries without reopening', async () => {
  mocks.listSessionsForSearch.mockRejectedValueOnce(new Error('offline'));
  const user = userEvent.setup();
  render(createElement(Sidebar, props()));
  await user.click(screen.getByRole('button', { name: 'search' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('searchLoadError');
  await user.click(screen.getByRole('button', { name: 'searchRetry' }));
  await screen.findByRole('option', { name: /Same title Project/ });
  expect(mocks.listSessionsForSearch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('prevents duplicate session opens and reports failures inside the modal', async () => {
  let reject!: (error: Error) => void;
  mocks.loadSession.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const user = userEvent.setup();
  render(createElement(Sidebar, props()));
  await user.click(screen.getByRole('button', { name: 'search' }));
  const row = await screen.findByRole('option', { name: /Same title Project/ });
  await user.dblClick(row);
  expect(mocks.loadSession).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('failed'));
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('searchOpenError');
  expect(screen.getByRole('dialog')).toBeTruthy();
});

test('makes collapsed content inert without remounting the tree', async () => {
  const user = userEvent.setup();
  const handlers = props();
  const view = render(createElement(Sidebar, handlers));
  const treeInput = screen.getByRole('textbox', { name: 'tree state' });
  await user.type(treeInput, 'Retain');
  view.rerender(createElement(Sidebar, { ...handlers, isCollapsed: true }));
  expect(treeInput.closest('[inert]')).not.toBeNull();
  view.rerender(createElement(Sidebar, handlers));
  expect(treeInput.closest('[inert]')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'tree state' })).toHaveValue('Retain');
});

test('honors the configured new-task shortcut and consumes it before the app handler', async () => {
  mocks.newShortcut = 'CmdOrCtrl+Shift+N';
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(Sidebar, handlers));
  await user.click(screen.getByRole('button', { name: 'search' }));
  await screen.findByRole('option', { name: /Same title Project/ });
  const appKeyDown = vi.fn();
  window.addEventListener('keydown', appKeyDown);
  try {
    await user.keyboard('{Meta>}{Shift>}N{/Shift}{/Meta}');
    expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
    expect(appKeyDown.mock.calls.some(([event]) => event.key === 'N')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  } finally {
    window.removeEventListener('keydown', appKeyDown);
  }
});

test('keeps the modal open when the session service returns a missing result', async () => {
  mocks.loadSession.mockResolvedValueOnce(null);
  const user = userEvent.setup();
  render(createElement(Sidebar, props()));
  await user.click(screen.getByRole('button', { name: 'search' }));
  await user.click(await screen.findByRole('option', { name: /Same title Project/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('searchOpenError');
  expect(screen.getByRole('dialog')).toBeTruthy();
});
