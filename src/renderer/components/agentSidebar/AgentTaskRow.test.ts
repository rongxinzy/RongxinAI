// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkSessionStatus } from '@shared/cowork/constants';
import AgentTaskRow from './AgentTaskRow';
import { AgentSidebarIndicator } from './constants';

vi.mock('react-redux', () => ({ useSelector: () => false }));
vi.mock('../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'en' },
}));
afterEach(cleanup);

function props() {
  return {
    task: {
      id: 'task-1',
      agentId: 'main',
      title: 'Sidebar task',
      status: CoworkSessionStatus.Completed,
      pinned: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
      indicator: AgentSidebarIndicator.None,
      isSelected: false,
    },
    isBatchMode: false,
    isSelected: false,
    onSelect: vi.fn(),
    onDelete: vi.fn(async () => {}),
    onShare: vi.fn(async () => {}),
    onTogglePin: vi.fn(async (_pinned: boolean) => {}),
    onRename: vi.fn(async (_title: string) => {}),
    onToggleSelection: vi.fn(),
    onEnterBatchMode: vi.fn(),
  };
}

test('selects with native Enter and Space without nesting action buttons', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(AgentTaskRow, handlers));
  const row = screen.getByRole('treeitem');
  expect(row.tagName).toBe('BUTTON');
  expect(row.querySelector('button')).toBeNull();
  row.focus();
  await user.keyboard('{Enter} ');
  expect(handlers.onSelect).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: 'coworkPinSession' }));
  expect(handlers.onTogglePin).toHaveBeenCalledWith(true);
  expect(handlers.onSelect).toHaveBeenCalledTimes(2);
});

test('keeps batch selection on the row and the separate checkbox', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(AgentTaskRow, { ...handlers, isBatchMode: true }));
  await user.click(screen.getByRole('treeitem'));
  await user.click(screen.getByRole('checkbox'));
  expect(handlers.onToggleSelection).toHaveBeenCalledTimes(2);
  expect(handlers.onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('treeitem').querySelector('input')).toBeNull();
});

test('opens the row menu by keyboard and saves a renamed title without selecting', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(AgentTaskRow, handlers));
  screen.getByRole('button', { name: 'coworkSessionActions' }).focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('menuitem', { name: 'renameConversation' }));
  const input = screen.getByRole('textbox');
  await waitFor(() => expect(input).toHaveFocus());
  await user.clear(input);
  await user.type(input, 'Renamed task{Enter}');
  expect(handlers.onRename).toHaveBeenCalledWith('Renamed task');
  expect(handlers.onSelect).not.toHaveBeenCalled();
});
