// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import ScheduledTasksView from './ScheduledTasksView';
import { consumeScheduledTaskCreateRequest, requestScheduledTaskCreate } from './createRequest';

const mocks = vi.hoisted(() => ({
  state: {
    scheduledTask: { tasks: [] },
    model: { availableModels: [], defaultSelectedModel: null },
    workspace: {
      currentWorkspaceId: 'current',
      workspaces: [
        { id: 'current', name: 'Current', path: '/projects/current', isHidden: false },
        { id: 'requested', name: 'Requested', path: '/projects/requested', isHidden: false },
      ],
    },
  },
}));
vi.mock('react-redux', () => ({
  useDispatch: () => vi.fn(),
  useSelector: (select: (state: unknown) => unknown) => select(mocks.state),
}));
vi.mock('../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'zh' },
}));
vi.mock('../../services/scheduledTask', () => ({
  scheduledTaskService: {
    isInitialized: true,
    loadTasks: async () => {},
    listChannels: async () => [],
  },
}));
vi.mock('../../services/cowork', () => ({ coworkService: {} }));
vi.mock('../PageHeader', () => ({
  default: ({ tabs }: { tabs: ReactNode }) => createElement('header', null, tabs),
}));
vi.mock('./TaskList', () => ({ default: () => null }));
vi.mock('./AllRunsHistory', () => ({ default: () => null }));
vi.mock('./TaskTemplateGallery', () => ({
  default: ({ onCustom }: { onCustom: () => void }) =>
    createElement('button', { onClick: onCustom }, 'custom'),
}));

beforeEach(() => {
  mocks.state.workspace.currentWorkspaceId = 'current';
  Element.prototype.scrollTo ??= vi.fn();
});
afterEach(() => {
  cleanup();
  consumeScheduledTaskCreateRequest();
});

test('a parked sidebar request opens the real form with the requested folder', async () => {
  requestScheduledTaskCreate({ workspaceId: 'requested' });
  render(createElement(ScheduledTasksView));
  const workspace = await screen.findByRole('combobox', { name: /scheduledTasksFormWorkspace/ });
  await waitFor(() => expect(workspace).toHaveTextContent('requested'));
  expect(consumeScheduledTaskCreateRequest()).toBeNull();
});

test('an already mounted view consumes new requests and does not leak the folder into custom creation', async () => {
  const user = userEvent.setup();
  render(createElement(ScheduledTasksView));
  await screen.findByRole('tab', { name: 'scheduledTasksNewTab' });
  act(() => requestScheduledTaskCreate({ workspaceId: 'requested' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: /scheduledTasksFormWorkspace/ })).toHaveTextContent(
      'requested',
    ),
  );
  await user.click(screen.getByRole('button', { name: 'cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  act(() => requestScheduledTaskCreate({ workspaceId: 'current' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: /scheduledTasksFormWorkspace/ })).toHaveTextContent(
      'current',
    ),
  );
  await user.click(screen.getByRole('button', { name: 'cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('tab', { name: 'scheduledTasksNewTab' }));
  await user.click(screen.getByRole('button', { name: 'custom' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: /scheduledTasksFormWorkspace/ })).toHaveTextContent(
      'current',
    ),
  );
});

test('changing the global folder does not overwrite a folder or draft in the open form', async () => {
  const user = userEvent.setup();
  requestScheduledTaskCreate({ workspaceId: 'requested' });
  const view = render(createElement(ScheduledTasksView));
  const workspace = await screen.findByRole('combobox', { name: /scheduledTasksFormWorkspace/ });
  await waitFor(() => expect(workspace).toHaveTextContent('requested'));
  const input = screen.getByRole('textbox', { name: /scheduledTasksFormName/ });
  await user.type(input, 'keep this task');
  mocks.state.workspace.currentWorkspaceId = 'requested';
  view.rerender(createElement(ScheduledTasksView));
  expect(input).toHaveValue('keep this task');
  expect(workspace).toHaveTextContent('requested');
});
