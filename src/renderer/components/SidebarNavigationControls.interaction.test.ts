// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { SidebarNavigationControls } from './SidebarNavigationControls';
import { WorkMode } from '../store/workMode/constants';

const mocks = vi.hoisted(() => ({
  state: {
    activity: { runs: [] as { status: string }[] },
    skill: { activeSkillIds: [] as string[] },
  },
  clearWorkspaceSelection: vi.fn(async () => {}),
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));
vi.mock('../services/workspace', () => ({
  workspaceService: { clearWorkspaceSelection: mocks.clearWorkspaceSelection },
}));
vi.mock('../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
beforeEach(() => {
  mocks.state = { activity: { runs: [] }, skill: { activeSkillIds: [] } };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const props = () => ({
  activeView: 'cowork' as const,
  workMode: WorkMode.Work,
  onNewChat: vi.fn(),
  onShowExpert: vi.fn(),
  onShowCoding: vi.fn(),
  onShowTodo: vi.fn(),
  onShowLocalInference: vi.fn(),
  onShowScheduledTasks: vi.fn(),
  onShowActivity: vi.fn(),
  onWorkModeChange: vi.fn(),
  onPrefetchView: vi.fn(),
});

test('changes work mode exactly once per click or keyboard activation', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(SidebarNavigationControls, handlers));
  const toggle = screen.getByRole('switch');
  await user.click(toggle);
  expect(handlers.onWorkModeChange).toHaveBeenCalledTimes(1);
  expect(handlers.onWorkModeChange.mock.calls[0][0]).toBe(true);
  handlers.onWorkModeChange.mockClear();
  toggle.focus();
  await user.keyboard(' ');
  expect(handlers.onWorkModeChange).toHaveBeenCalledTimes(1);
});

test('preserves new-task workspace cleanup and view navigation callbacks', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(SidebarNavigationControls, { ...handlers, activeView: 'todo' }));
  await user.click(screen.getByTestId('sidebar-new-conversation'));
  expect(mocks.clearWorkspaceSelection).toHaveBeenCalledTimes(1);
  expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  expect(mocks.clearWorkspaceSelection.mock.invocationCallOrder[0]).toBeLessThan(
    handlers.onNewChat.mock.invocationCallOrder[0],
  );
  const views = [
    ['localInferenceTitle', handlers.onShowLocalInference, 'localInference'],
    ['codingAgent', handlers.onShowCoding, undefined],
    ['todoTitle', handlers.onShowTodo, 'todo'],
    ['scheduledTasks', handlers.onShowScheduledTasks, 'scheduledTasks'],
    ['activityTitle', handlers.onShowActivity, 'activity'],
    ['expert', handlers.onShowExpert, 'expert'],
  ] as const;
  for (const [label, callback, prefetch] of views) {
    const button = screen.getByRole('button', { name: label });
    handlers.onPrefetchView.mockClear();
    await user.hover(button);
    if (prefetch) expect(handlers.onPrefetchView).toHaveBeenCalledWith(prefetch);
    handlers.onPrefetchView.mockClear();
    button.focus();
    if (prefetch) expect(handlers.onPrefetchView).toHaveBeenCalledWith(prefetch);
    await user.keyboard('{Enter}');
    expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(screen.getByRole('button', { name: 'todoTitle' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByTestId('sidebar-new-conversation')).not.toHaveAttribute('aria-current');
});

test('keeps managed-only and chat navigation policies and chat workspace selection', async () => {
  const user = userEvent.setup();
  const handlers = props();
  const view = render(
    createElement(SidebarNavigationControls, { ...handlers, managedModelsOnly: true }),
  );
  expect(screen.queryByRole('button', { name: 'localInferenceTitle' })).toBeNull();
  expect(screen.getByRole('button', { name: 'todoTitle' })).toBeTruthy();
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'newChat' }));
  expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  expect(mocks.clearWorkspaceSelection).not.toHaveBeenCalled();
  await user.click(screen.getByRole('switch', { name: 'workMode / chatMode' }));
  expect(handlers.onWorkModeChange.mock.calls[0][0]).toBe(false);
});

test('preserves activity status and skill-aware new-conversation highlighting', () => {
  mocks.state = {
    activity: { runs: [{ status: 'running' }] },
    skill: { activeSkillIds: ['skill-1'] },
  };
  const handlers = props();
  const view = render(createElement(SidebarNavigationControls, handlers));
  expect(
    screen.getByTestId('sidebar-view-activity').querySelector('span[aria-hidden="true"]'),
  ).toBeTruthy();
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.getByTestId('sidebar-new-conversation')).toHaveAttribute('data-active', 'false');
  mocks.state = { activity: { runs: [] }, skill: { activeSkillIds: [] } };
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.getByTestId('sidebar-new-conversation')).toHaveAttribute('data-active', 'true');
});
