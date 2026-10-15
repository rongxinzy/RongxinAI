// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import { Provider } from 'react-redux';
import { beforeEach, expect, test, vi } from 'vitest';

import { AgentId } from '../../shared/agent';
import { CoworkSessionSource } from '../../shared/cowork/constants';
import { store } from '../store';
import {
  setCurrentSessionId,
  setSessions,
  updateSessionStatus,
  updateSessionTitle,
} from '../store/slices/coworkSlice';
import { setCurrentWorkspaceId, setWorkspaces } from '../store/slices/workspaceSlice';
import { WorkMode } from '../store/workMode/constants';
import { CoworkSessionStatusValue, type CoworkSessionSummary } from '../types/cowork';
import { AgentSidebarIndicator } from './agentSidebar/constants';
import type WorkspaceTreeNode from './agentSidebar/WorkspaceTreeNode';
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
vi.mock('../services/config', () => ({ configService: {} }));
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
vi.mock('./SidebarNavigationControls', () => ({ SidebarNavigationControls: () => null }));
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
  store.dispatch(setSessions([session]));
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
