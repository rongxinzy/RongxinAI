// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import { Provider } from 'react-redux';
import { beforeEach, expect, test, vi } from 'vitest';

import { AgentId } from '../../shared/agent';
import { CoworkSessionSource } from '../../shared/cowork/constants';
import { store } from '../store';
import {
  setCurrentSessionId,
  setChatSessions,
  setSessions,
  updateSessionStatus,
  updateSessionTitle,
} from '../store/slices/coworkSlice';
import { setCurrentWorkspaceId, setWorkspaces } from '../store/slices/workspaceSlice';
import { WorkMode } from '../store/workMode/constants';
import { setWorkMode } from '../store/workMode/workModeSlice';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../types/cowork';
import { AgentSidebarIndicator } from './agentSidebar/constants';
import type WorkspaceTreeNode from './agentSidebar/WorkspaceTreeNode';
import type AgentTaskRow from './agentSidebar/AgentTaskRow';
import type { SidebarNavigationControls } from './SidebarNavigationControls';
import { consumeScheduledTaskCreateRequest } from './scheduledTasks/createRequest';
import Sidebar from './Sidebar';

type WorkspaceRowProps = ComponentProps<typeof WorkspaceTreeNode>;
const mocks = vi.hoisted(() => ({
  renderWorkspace: vi.fn<(props: WorkspaceRowProps) => void>(),
  previews: [] as CoworkSessionSummary[],
  languageListeners: new Set<() => void>(),
  language: 'en' as 'zh' | 'en',
  listPreviews: vi.fn(),
}));

vi.mock('../services/cowork', () => ({
  coworkService: { listSessionsForWorkspacePreview: mocks.listPreviews },
}));
vi.mock('../services/agent', () => ({ agentService: {} }));
vi.mock('../services/workspace', () => ({ workspaceService: {} }));
vi.mock('../services/config', () => ({ configService: { updateConfig: vi.fn() } }));
vi.mock('../services/store', () => ({
  localStore: { getItem: async () => null, setItem: async () => {} },
}));
vi.mock('../services/i18n', () => ({
  i18nService: {
    t: (key: string) => `${mocks.language}:${key}`,
    getLanguage: () => mocks.language,
    subscribe: (listener: () => void) => {
      mocks.languageListeners.add(listener);
      return () => mocks.languageListeners.delete(listener);
    },
  },
}));
vi.mock('./SidebarNavigationControls', () => ({
  SidebarNavigationControls: (props: ComponentProps<typeof SidebarNavigationControls>) =>
    createElement(
      'button',
      {
        onClick: () => props.onWorkModeChange(props.workMode !== WorkMode.Chat),
      },
      'switch mode',
    ),
}));
vi.mock('./agentSidebar/AgentTaskRow', () => ({
  default: (props: ComponentProps<typeof AgentTaskRow>) =>
    createElement(
      'div',
      { 'data-testid': props.task.id },
      createElement(
        'output',
        null,
        JSON.stringify({ batch: props.isBatchMode, selected: props.isSelected }),
      ),
      createElement('button', { onClick: props.onEnterBatchMode }, 'chat batch'),
    ),
}));
vi.mock('./LoginButton', () => ({ default: () => null }));
vi.mock('./chat/ChatSkillShortcuts', () => ({ default: () => null }));
vi.mock('./coding/CodingWorkspaceSidebar', () => ({ CodingWorkspaceSidebar: () => null }));
vi.mock('./cowork/CoworkSearchModal', () => ({ default: () => null }));
vi.mock('./cowork/CreateProjectDialog', () => ({ default: () => null }));
vi.mock('./agentSidebar/EditProjectDialog', () => ({ default: () => null }));
vi.mock('./agentSidebar/WorkspaceTreeNode', () => ({
  default: (props: WorkspaceRowProps) => {
    mocks.renderWorkspace(props);
    const { workspace } = props;
    return createElement(
      'div',
      { 'data-testid': workspace.tasks[0]?.id ?? workspace.id },
      createElement(
        'output',
        null,
        JSON.stringify({
          workspace,
          active: props.isActiveWorkspace,
          selected: [...props.selectedIds],
          batch: props.isBatchMode,
        }),
      ),
      createElement('button', { onClick: () => props.onToggleExpanded(workspace.id) }, 'expand'),
      createElement('button', { onClick: () => props.onCreateTask(workspace) }, 'create'),
      createElement(
        'button',
        { onClick: () => props.onEnterBatchMode(workspace.tasks[0]) },
        'batch',
      ),
    );
  },
}));

const workspace = {
  id: 'project',
  name: 'Project',
  path: '/project',
  isHidden: false,
  createdAt: 1,
  updatedAt: 1,
};
const session: CoworkSessionSummary = {
  id: 'history',
  agentId: AgentId.Main,
  workspaceId: workspace.id,
  title: 'History',
  status: CoworkSessionStatusValue.Idle,
  mode: WorkMode.Work,
  source: CoworkSessionSource.Manual,
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
};
const props = (): ComponentProps<typeof Sidebar> => ({
  activeView: 'cowork',
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
  codingSelection: { workspaceId: null, workspaceRoot: '', laneId: null, draft: null },
  onCodingSelectionChange: vi.fn(),
});

async function mountSidebar() {
  const handlers = props();
  const element = (overrides: Partial<ComponentProps<typeof Sidebar>> = {}) =>
    createElement(
      Provider,
      // createElement supplies children as its third argument; Provider's props require it.
      { store } as ComponentProps<typeof Provider>,
      createElement(Sidebar, { ...handlers, ...overrides }),
    );
  const view = render(element());
  await waitFor(() => expect(screen.getByTestId(session.id)).toHaveTextContent(session.title));
  await waitFor(() => expect(mocks.listPreviews).toHaveBeenCalledTimes(2));
  // Flush preview loading, preference hydration and auto-expansion before counting renders.
  await act(async () => {});
  return { ...view, element, handlers };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = 'en';
  mocks.previews = [
    session,
    { ...session, id: 'scheduled', source: CoworkSessionSource.Scheduled },
  ];
  mocks.listPreviews.mockImplementation(
    async (_id: string, _limit: number, _offset: number, sources: CoworkSessionSource[]) => ({
      success: true,
      sessions: mocks.previews.filter(s => sources.includes(s.source)),
      hasMore: false,
    }),
  );
  store.dispatch(setWorkspaces([workspace]));
  store.dispatch(setCurrentWorkspaceId(null));
  store.dispatch(setCurrentSessionId(null));
  store.dispatch(setWorkMode(WorkMode.Work));
  store.dispatch(setSessions([session]));
  store.dispatch(
    setChatSessions([
      { ...session, id: 'chat-one', mode: WorkMode.Chat },
      { ...session, id: 'chat-two', mode: WorkMode.Chat },
    ]),
  );
  consumeScheduledTaskCreateRequest();
  window.electron = { platform: 'win32' } as typeof window.electron;
});

test('navigation skips history renders and preserves expanded state and cached previews', async () => {
  const view = await mountSidebar();
  const renders = mocks.renderWorkspace.mock.calls.length;
  const initialRow = screen.getByTestId(session.id);
  const expanded = initialRow.textContent;
  const routes: ComponentProps<typeof Sidebar>['activeView'][] = [
    'todo',
    'scheduledTasks',
    'activity',
    'expert',
    'coding',
    'settings',
    'cowork',
  ];
  for (const activeView of routes) view.rerender(view.element({ activeView }));
  expect(mocks.renderWorkspace).toHaveBeenCalledTimes(renders);
  expect(mocks.listPreviews).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId(session.id)).toBe(initialRow);
  expect(initialRow.textContent).toBe(expanded);

  fireEvent.click(screen.getAllByRole('button', { name: 'expand' })[0]);
  expect(mocks.renderWorkspace.mock.calls.length).toBeGreaterThan(renders);
  expect(initialRow).toHaveTextContent('"isExpanded":false');
});

test('memoized history still reacts to selection, streaming, unread, titles and language', async () => {
  await mountSidebar();
  act(() => store.dispatch(setCurrentSessionId(session.id)));
  expect(screen.getByTestId(session.id)).toHaveTextContent('"isSelected":true');
  act(() => store.dispatch(setCurrentWorkspaceId(workspace.id)));
  expect(screen.getByTestId(session.id)).toHaveTextContent('"active":true');
  act(() => store.dispatch(updateSessionTitle({ sessionId: session.id, title: 'Renamed' })));
  await waitFor(() => expect(screen.getByTestId(session.id)).toHaveTextContent('Renamed'));
  act(() =>
    store.dispatch(
      updateSessionStatus({ sessionId: session.id, status: CoworkSessionStatusValue.Running }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId(session.id)).toHaveTextContent(AgentSidebarIndicator.Running),
  );
  act(() => store.dispatch(setCurrentSessionId(null)));
  act(() =>
    store.dispatch(
      updateSessionStatus({ sessionId: session.id, status: CoworkSessionStatusValue.Completed }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId(session.id)).toHaveTextContent(AgentSidebarIndicator.CompletedUnread),
  );
  act(() => {
    mocks.language = 'zh';
    mocks.languageListeners.forEach(listener => listener());
  });
  expect(screen.getByRole('tree')).toHaveAttribute('aria-label', 'zh:workspaces');
});

test('batch selection and replacement callbacks reach the memoized tree', async () => {
  const view = await mountSidebar();
  fireEvent.click(screen.getAllByRole('button', { name: 'batch' })[0]);
  expect(screen.getByTestId(session.id)).toHaveTextContent('"batch":true');
  expect(screen.getByTestId(session.id)).toHaveTextContent('"selected":["history"]');

  const onShowScheduledTasks = vi.fn();
  view.rerender(view.element({ onShowScheduledTasks }));
  fireEvent.click(screen.getAllByRole('button', { name: 'create' })[1]);
  expect(onShowScheduledTasks).toHaveBeenCalledOnce();
  expect(view.handlers.onShowScheduledTasks).not.toHaveBeenCalled();
  expect(consumeScheduledTaskCreateRequest()).toEqual({ workspaceId: workspace.id });
});

test('bidirectional mode switches skip unchanged work history and keep expansion and previews', async () => {
  await mountSidebar();
  const renders = mocks.renderWorkspace.mock.calls.length;
  const row = screen.getByTestId(session.id);
  const expanded = row.textContent;
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'switch mode' }));
  expect(store.getState().workMode.mode).toBe(WorkMode.Work);
  expect(mocks.renderWorkspace).toHaveBeenCalledTimes(renders);
  expect(mocks.listPreviews).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId(session.id)).toBe(row);
  expect(row.textContent).toBe(expanded);
});

test('mode switches exit batch selection and keep work and chat select-all scopes separate', async () => {
  await mountSidebar();
  fireEvent.click(screen.getAllByRole('button', { name: 'batch' })[0]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'en:batchSelectAll' }));
  expect(screen.getByTestId(session.id)).toHaveTextContent('"selected":["history","scheduled"]');
  fireEvent.click(screen.getByRole('button', { name: 'switch mode' }));
  expect(screen.queryByRole('checkbox', { name: 'en:batchSelectAll' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'chat batch' })[0]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'en:batchSelectAll' }));
  expect(screen.getByTestId('chat-one')).toHaveTextContent('"selected":true');
  expect(screen.getByTestId('chat-two')).toHaveTextContent('"selected":true');
  expect(screen.getByTestId(session.id)).toHaveTextContent('"selected":["chat-one","chat-two"]');
  fireEvent.click(screen.getByRole('button', { name: 'switch mode' }));
  expect(screen.getByTestId(session.id)).toHaveTextContent('"batch":false');
  expect(screen.getByTestId(session.id)).toHaveTextContent('"selected":[]');
  fireEvent.click(screen.getAllByRole('button', { name: 'batch' })[0]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'en:batchSelectAll' }));
  expect(screen.getByTestId(session.id)).toHaveTextContent('"selected":["history","scheduled"]');
});

test('hidden asynchronous work preview updates cannot overwrite chat select-all', async () => {
  await mountSidebar();
  const late = { ...session, id: 'late-work', workspaceId: 'late-project' };
  let resolvePreview!: (value: {
    success: boolean;
    sessions: CoworkSessionSummary[];
    hasMore: boolean;
  }) => void;
  mocks.listPreviews.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolvePreview = resolve;
      }),
  );
  act(() => store.dispatch(setWorkspaces([workspace, { ...workspace, id: 'late-project' }])));
  await waitFor(() => expect(resolvePreview).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'switch mode' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'chat batch' })[0]);
  await act(async () => resolvePreview({ success: true, sessions: [late], hasMore: false }));
  await waitFor(() => expect(screen.getByTestId(late.id)).toBeTruthy());
  fireEvent.click(screen.getByRole('checkbox', { name: 'en:batchSelectAll' }));
  expect(screen.getByTestId('chat-one')).toHaveTextContent('"selected":true');
  expect(screen.getByTestId('chat-two')).toHaveTextContent('"selected":true');
  expect(screen.getByRole('checkbox', { name: 'en:batchSelectAll' })).toBeChecked();
  expect(within(screen.getByTestId(late.id)).getByRole('status')).toHaveTextContent(
    '"selected":["chat-one","chat-two"]',
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'en:batchSelectAll' }));
  expect(screen.getByTestId('chat-one')).toHaveTextContent('"selected":false');
  expect(screen.getByTestId('chat-two')).toHaveTextContent('"selected":false');
});

test('hidden work history still responds to current session, stream, unread, title and language', async () => {
  await mountSidebar();
  fireEvent.click(screen.getByRole('button', { name: 'switch mode' }));
  act(() => store.dispatch(setCurrentSessionId(session.id)));
  expect(screen.getByTestId(session.id)).toHaveTextContent('"isSelected":true');
  act(() =>
    store.dispatch(updateSessionTitle({ sessionId: session.id, title: 'Background rename' })),
  );
  await waitFor(() =>
    expect(screen.getByTestId(session.id)).toHaveTextContent('Background rename'),
  );
  act(() =>
    store.dispatch(
      updateSessionStatus({ sessionId: session.id, status: CoworkSessionStatusValue.Running }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId(session.id)).toHaveTextContent(AgentSidebarIndicator.Running),
  );
  act(() => store.dispatch(setCurrentSessionId(null)));
  act(() =>
    store.dispatch(
      updateSessionStatus({ sessionId: session.id, status: CoworkSessionStatusValue.Completed }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId(session.id)).toHaveTextContent(AgentSidebarIndicator.CompletedUnread),
  );
  act(() => {
    mocks.language = 'zh';
    mocks.languageListeners.forEach(listener => listener());
  });
  expect(screen.getByRole('tree', { hidden: true })).toHaveAttribute('aria-label', 'zh:workspaces');
  fireEvent.click(screen.getByRole('button', { name: 'switch mode' }));
  expect(screen.getByTestId(session.id)).toHaveTextContent('Background rename');
  expect(mocks.listPreviews).toHaveBeenCalledTimes(2);
});
